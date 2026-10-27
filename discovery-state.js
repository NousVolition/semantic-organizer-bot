const { createHash, createCipheriv, createDecipheriv, randomBytes, hkdfSync } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');

const BRANCH = 'semantic-bot-state';
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_STORED_BYTES = 64 * 1024 * 1024;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const failure = code => Object.assign(new Error(code), { code });

// The reporting repository may be public. Raw source indexes and unreviewed
// model responses must never be committed in plaintext, even on this branch.
function codec(secret, scope) {
  if (typeof secret !== 'string' || secret.length < 16) throw failure('checkpoint_secret');
  const key = Buffer.from(hkdfSync('sha256', secret, scope, 'semantic-discovery-state-v1', 32));
  return {
    encode(value, path) {
      const json = Buffer.from(JSON.stringify(value));
      if (json.length > MAX_BYTES) throw failure('checkpoint_capacity');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(path));
      const data = Buffer.concat([cipher.update(gzipSync(json)), cipher.final()]);
      const envelope = Buffer.from(JSON.stringify({ version: 1, iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
      if (envelope.length > MAX_STORED_BYTES) throw failure('checkpoint_capacity');
      return envelope.toString('base64');
    },
    decode(content, path) {
      try {
        if (content.length > MAX_STORED_BYTES * 2) throw new Error();
        const e = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
        if (e.version !== 1) throw new Error();
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
        decipher.setAAD(Buffer.from(path));
        decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
        const data = Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]);
        return JSON.parse(gunzipSync(data, { maxOutputLength: MAX_BYTES }).toString('utf8'));
      } catch { throw failure('checkpoint_unreadable'); }
    }
  };
}

function createGitHubStateStore(octokit, config, secret) {
  const args = { owner: config.owner, repo: config.controlRepository };
  const crypt = codec(secret, `${args.owner}/${args.repo}`);
  const versions = new Map();
  let ready;
  async function initialize() {
    const { data: repo } = await octokit.repos.get(args);
    if (repo.default_branch === BRANCH) throw failure('checkpoint_branch');
    try { await octokit.git.getRef({ ...args, ref: `heads/${BRANCH}` }); }
    catch (error) {
      if (error.status !== 404) throw error;
      // An orphan branch contains only state, with no executable workflows.
      const { data: blob } = await octokit.git.createBlob({ ...args, content: 'Encrypted discovery state. Do not merge into main.\n', encoding: 'utf-8' });
      const { data: tree } = await octokit.git.createTree({ ...args, tree: [{ path: 'README.txt', mode: '100644', type: 'blob', sha: blob.sha }] });
      const { data: commit } = await octokit.git.createCommit({ ...args, message: 'Initialize encrypted discovery state [skip ci]', tree: tree.sha, parents: [] });
      try { await octokit.git.createRef({ ...args, ref: `refs/heads/${BRANCH}`, sha: commit.sha }); }
      catch (race) {
        if (race.status !== 422) throw race;
        await octokit.git.getRef({ ...args, ref: `heads/${BRANCH}` });
      }
    }
  }
  const pathFor = key => `state/${hash(key).slice(0, 2)}/${hash(key)}.json`;
  async function get(key) {
    await (ready ||= initialize());
    const path = pathFor(key);
    let data;
    try {
      ({ data } = await octokit.repos.getContent({ ...args, path, ref: BRANCH, headers: { accept: 'application/vnd.github.object+json' } }));
    } catch (error) {
      if (error.status !== 404) throw error;
      versions.set(key, null);
      return undefined;
    }
    if (data.type !== 'file' || data.size > MAX_STORED_BYTES) throw failure('checkpoint_unreadable');
    const sha = data.sha;
    if (data.encoding === 'none') ({ data } = await octokit.git.getBlob({ ...args, file_sha: sha }));
    if (data.encoding !== 'base64') throw failure('checkpoint_unreadable');
    const value = crypt.decode(data.content, path);
    versions.set(key, sha);
    return value;
  }
  async function set(key, value) {
    if (!versions.has(key)) await get(key);
    const path = pathFor(key), sha = versions.get(key);
    try {
      const { data } = await octokit.repos.createOrUpdateFileContents({ ...args, branch: BRANCH, path,
        message: 'Save encrypted discovery progress [skip ci]', content: crypt.encode(value, path), ...(sha ? { sha } : {}) });
      versions.set(key, data.content.sha);
    } catch (error) {
      if ([409, 422].includes(error.status)) throw failure('checkpoint_conflict');
      throw error;
    }
  }
  // GitHub Contents mutations must be sequential, including lease heartbeats.
  let queue = Promise.resolve();
  const serial = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; };
  return { get: key => serial(() => get(key)), set: (key, value) => serial(() => set(key, value)),
    update: (key, fn) => serial(async () => { const value = fn(await get(key)); await set(key, value); return value; }) };
}

// A repository-wide lease covers all discovery jobs across overlapping deploys.
// A lost lease fences subsequent paid work, checkpoints and publication.
async function acquireLease(store, { now = Date.now, ttl = 180000, interval = 30000 } = {}) {
  const owner = randomBytes(16).toString('hex'), key = 'discovery/lease';
  let lost = false;
  await store.update(key, previous => {
    if (previous?.expires > now()) throw failure('checkpoint_busy');
    return { owner, expires: now() + ttl };
  });
  const renew = () => store.update(key, previous => {
    if (lost || previous?.owner !== owner || previous.expires <= now()) throw failure('checkpoint_lease_lost');
    return { owner, expires: now() + ttl };
  });
  const timer = setInterval(() => renew().catch(() => { lost = true; }), interval);
  timer.unref?.();
  return {
    async check() {
      const previous = await store.get(key);
      if (lost || previous?.owner !== owner || previous.expires <= now()) throw failure('checkpoint_lease_lost');
    },
    async release() {
      clearInterval(timer);
      await store.update(key, previous => {
        if (previous?.owner !== owner) throw failure('checkpoint_lease_lost');
        return { owner, expires: 0 };
      });
    }
  };
}

function createCheckpoint(state, save, check = async () => {}) {
  state.steps ||= {};
  return { async run(name, work) {
    await check();
    if (Object.hasOwn(state.steps, name)) return structuredClone(state.steps[name]);
    const value = await work();
    await check();
    state.steps[name] = value;
    try { await save(); } catch (error) { delete state.steps[name]; throw error; }
    return structuredClone(value);
  } };
}

module.exports = { BRANCH, codec, hash, createGitHubStateStore, acquireLease, createCheckpoint };
