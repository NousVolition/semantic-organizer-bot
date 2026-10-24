const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { completePassages, settingsKey, readingRecord, parseReadingRecord } = require('../complete-reading');
const { collectSources, createDiscoveryHandler, renderDiscovery } = require('../discovery');
const { reviewPublishedReport } = require('../report-review');
const helpers = require('../discovery');
const { CHECKS } = require('../comparison-audit');

const config = { owner: 'example', controlRepository: 'bot', repositories: ['alpha', 'beta'],
  readingMode: 'complete', filesPerBatch: 2, charactersPerFile: 600, maximumFileBytes: 10000 };
const texts = { alpha: 'A precise observation remains in this source.\n'.repeat(55),
  beta: 'A related observation has a different setting.\n'.repeat(45) };
function api({ privateRepo } = {}) {
  const reads = [], refs = [];
  return { reads, refs, repos: {
    get: async ({ repo }) => ({ data: { private: repo === privateRepo, default_branch: 'main' } }),
    getCommit: async ({ repo, ref }) => { refs.push(ref); return { data: { sha: (repo === 'alpha' ? 'a' : 'b').repeat(40), commit: { tree: { sha: repo } } } }; },
    getContent: async ({ repo }) => ({ data: { type: 'file', encoding: 'base64', size: texts[repo].length, content: Buffer.from(texts[repo]).toString('base64') } })
  }, git: {
    getTree: async ({ repo }) => ({ data: { tree: [
      { type: 'blob', mode: '100644', path: 'notes.md', sha: repo, size: texts[repo].length },
      { type: 'blob', mode: '100644', path: 'secrets/key.txt', sha: 'secret', size: 10 },
      { type: 'blob', mode: '100644', path: 'paper.pdf', sha: 'pdf', size: 10 },
      { type: 'blob', mode: '100644', path: 'huge.txt', sha: 'huge', size: 20000 }
    ] } }),
    getBlob: async ({ file_sha }) => { reads.push(file_sha); return { data: { encoding: 'base64', content: Buffer.from(texts[file_sha]).toString('base64') } }; }
  } };
}
test('complete windows cover every character, retain lines and handle long lines and Unicode', () => {
  for (const input of ['', 'short', 'line\r\n'.repeat(400), '😀'.repeat(1200), 'a'.repeat(2400)]) {
    const text = input.replace(/\r\n/g, '\n'), seen = new Uint8Array(text.length);
    const parts = completePassages(input, 600);
    for (const p of parts) {
      assert.equal(p.text, text.slice(p.start, p.end));
      assert.ok(p.text.length <= 600);
      assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.text));
      assert.equal(p.startLine, text.slice(0, p.start).split('\n').length);
      seen.fill(1, p.start, p.end);
    }
    assert.ok(seen.every(n => n === 1));
    if (text.length) assert.equal(parts.at(-1).end, text.length);
  }
});
test('complete batches cover the pinned index without gaps or false distinct-source identities', async () => {
  const github = api(), first = await collectSources(github, config);
  const all = [];
  for (let batch = 1; batch <= first.totalBatches; batch++) {
    const result = await collectSources(github, config, batch, first.repositories);
    assert.ok(result.selectedWindows <= 2);
    assert.ok(result.sources.length >= 2);
    assert.equal(new Set(result.sources.map(s => s.url)).size, result.sources.length);
    assert.ok(result.contextWindows<=5);
    for(const source of result.sources) for(let i=1;i<source.excerpts.length;i++)
      assert.ok(source.excerpts[i].start>=source.excerpts[i-1].end,'retrieved overlap must not duplicate source characters');
    all.push(...result.sources);
  }
  for (const repo of config.repositories) {
    const seen = new Uint8Array(texts[repo].length);
    for (const s of all.filter(s => s.repository.endsWith('/' + repo)))
      for (const p of s.excerpts) seen.fill(1, p.start, p.end);
    assert.ok(seen.every(n => n === 1));
  }
  assert.deepEqual(first.excluded, { pathOrFormat: 4, oversized: 2, unreadable: 0 });
  assert.ok(github.reads.every(s => ['alpha', 'beta'].includes(s)));
  assert.equal(github.reads.length, 2, 'unchanged blobs are downloaded only once across batches');
  assert.ok(github.refs.slice(2).every(ref => /^[ab]{40}$/.test(ref)));
});
test('private continuations and invalid snapshots stop before blob reads', async () => {
  const github = api({ privateRepo: 'beta' });
  await assert.rejects(collectSources(github, config), { code: 'private_source' });
  assert.equal(github.reads.length, 0);
  await assert.rejects(collectSources(api(), config, 2, [{ repo: 'alpha', commit: 'main' }]), /snapshot/);
});
test('preview continuation analyzes the same batch and keeps snapshots pinned', async () => {
  const github = api(), saved = new Map(), posted = [];
  github.paginate = async (_method, p) => saved.get(p.issue_number) || [];
  github.issues = { listComments() {}, createComment: async p => ({ data: { id: p.issue_number } }),
    updateComment: async p => { saved.set(p.comment_id, [{ user: { type: 'Bot' }, body: p.body }]); posted.push(p.body); } };
  const calls = [];
  const openai = { chat: { completions: { create: async r => { calls.push(r); return { choices: [{ finish_reason: 'stop', message: { content: '{"connections":[]}' } }] }; } } } };
  const handler = createDiscoveryHandler({ config, openai, model: 'test', skills: '', log: { error() {} } });
  const context = (n, title) => ({ octokit: github, issue: () => ({ owner: 'example', repo: 'bot', issue_number: n }),
    payload: { sender: { type: 'User', login: 'example' }, repository: { name: 'bot', full_name: 'example/bot', owner: { login: 'example' } }, issue: { number: n, title, user: { type: 'User' } } } });
  await handler.handle(context(1, '[Discover language] preview')); await handler.waitForIdle();
  assert.equal(calls.length, 0);
  assert.equal(parseReadingRecord(posted[0]).nextBatch, 1);
  await handler.handle(context(2, '[Discover language] continue 1')); await handler.waitForIdle();
  assert.equal(calls.length, 1);
  assert.equal(parseReadingRecord(posted[1]).batch, 1);
  assert.equal(parseReadingRecord(posted[1]).nextBatch, 2);
  assert.deepEqual(github.refs.slice(2), ['a'.repeat(40), 'b'.repeat(40)]);
  // Tampering with settings must not silently resume under different windows.
  const changed = { ...config, charactersPerFile: 700 };
  assert.notEqual(settingsKey(config), settingsKey(changed));
});
test('saved deep-section citations can be re-reviewed with their original adjacent context', async () => {
  const github = api(), collected = await collectSources(github, config, 3);
  const connection = { title: 'Related observations', kind: 'interpretive', relationship: 'Both sources describe observations.',
    limit: 'This does not establish a shared cause.', words: [{ term: 'parallel observation', kind: 'candidate', fit: 'A limited comparison.' }],
    evidence: { S1: 'S1P1', S2: 'S2P1' }, confidence: { level: 'medium', band: 'lower', basis: 'The observations are supplied but the relation is tentative.', strengthen: 'Compare their contexts.', pullBack: 'Do not infer a shared cause.' } };
  const marker = `<!-- semantic-discovery:${createHash('sha256').update('example/bot#45').digest('hex').slice(0,16)} -->`;
  const body = marker + '\n' + renderDiscovery({ connections: [connection] }, collected)
    + `\n<!-- complete-reading:${Buffer.from(JSON.stringify(readingRecord(collected))).toString('base64')} -->`;
  github.issues = { listComments() {} };
  github.paginate = async () => [{ id: 12, user: { type: 'Bot' }, body }];
  let calls = 0;
  const openai = { chat: { completions: { create: async request => {
    if(request.response_format.json_schema.name === 'word_meaning_audit') return require('./helpers/word-response')(request);
    calls++;
    const data = JSON.parse(request.messages[1].content);
    assert.ok(data.passages.every(p => p.startLine > 1));
    assert.equal(JSON.parse(data.candidates[0].fields.confidence).band, 'lower');
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ C1: {
      fields: Object.fromEntries(Object.entries(data.candidates[0].fields).map(([key, proposition]) => [key, { stance: 'asserted', proposition, status: 'pass', reason: 'Test verdict.' }])),
      checks: Object.fromEntries(CHECKS.map(k => [k, 'pass'])), reason: 'Test verdict.', passages: ['S1P1','S2P1']
    } }) } }] };
  } } } };
  const report = await reviewPublishedReport({ octokit: github, config, reportIssue: 45, openai, model: 'test', helpers });
  assert.equal(calls, 1); assert.match(report, /Original confidence assessment: Pass/);
});
