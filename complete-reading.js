const { createHash } = require('node:crypto');
const { hash } = require('./discovery-state');
const { terms, indexContext } = require('./context-windows');
// Completed indexes are reused, including windows and term frequencies. Retain
// at most one in memory; durable chunks below survive process replacement.
let warmIndex;

async function verifyPublicSources(octokit, config) {
  const metadata = [];
  for (const repo of [...new Set(config.repositories)]) {
    const { data } = await octokit.repos.get({ owner: config.owner, repo });
    if (data.private !== false || (data.visibility && data.visibility !== 'public'))
      throw Object.assign(new Error('Private source'), { code: 'private_source' });
    metadata.push({ repo, data });
  }
  return metadata;
}

// Overlapping, contiguous windows: every character belongs to at least one
// window, even when a source has a single very long line.
function completePassages(input, budget) {
  const text = input.replace(/\r\n/g, '\n');
  if (!Number.isInteger(budget) || budget < 300 || budget > 8000) throw new Error('Invalid passage budget');
  const overlap = Math.min(400, Math.floor(budget / 5));
  const parts = [];
  let start = 0, line = 1;
  while (start < text.length) {
    let end = Math.min(start + budget, text.length);
    // Do not split a UTF-16 surrogate pair.
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push({ startLine: line, start, end, text: text.slice(start, end) });
    if (end === text.length) break;
    let next = end - overlap;
    if (/[\uDC00-\uDFFF]/.test(text[next])) next--;
    line += (text.slice(start, next).match(/\n/g) || []).length;
    start = next;
  }
  return parts;
}

function settingsKey(config) {
  return createHash('sha256').update(JSON.stringify({
    version: 2, contextRetrieval: 'adjacent-and-distinctive-terms-v1', owner: config.owner, repositories: [...new Set(config.repositories)],
    size: config.filesPerBatch, budget: config.charactersPerFile,
    maximum: config.maximumFileBytes, priorities: config.priorityPaths || []
  })).digest('hex');
}

function validateSnapshot(snapshot, config) {
  if (!Array.isArray(snapshot) || snapshot.length !== new Set(config.repositories).size
    || new Set(snapshot.map(r => r.repo)).size !== snapshot.length
    || snapshot.some(r => !config.repositories.includes(r.repo) || !/^[0-9a-f]{40}$/.test(r.commit)))
    throw new Error('Invalid pinned reading snapshot');
}

async function collectCompleteSources(octokit, config, batch, eligible, snapshot, options = {}) {
  if (snapshot) validateSnapshot(snapshot, config);
  const metadata = await verifyPublicSources(octokit, config);
  const pinned = [];
  for (const {repo, data} of metadata) {
    const ref = snapshot?.find(r => r.repo === repo).commit || data.default_branch;
    const {data: commit} = await octokit.repos.getCommit({ owner: config.owner, repo, ref });
    if (snapshot && commit.sha !== ref) throw new Error('Pinned commit changed');
    pinned.push({repo, commit: commit.sha, tree: commit.commit.tree.sha});
  }
  // Persist the snapshot before indexing: a retry must not mix new source heads
  // with chunks already read before the interruption.
  if (options.onSnapshot) await options.onSnapshot(pinned.map(({repo,commit}) => ({repo,commit})));
  const key = `reading-index-v3/${hash({settings: settingsKey(config), pinned})}`;
  let index = warmIndex?.key === key && warmIndex.durable === Boolean(options.store) ? warmIndex.index : undefined;
  if (!index) {
    const memo = async (name, work) => {
      await options.check?.();
      const saved = await options.store?.get(name);
      if (saved !== undefined) return saved;
      const value = await work();
      await options.check?.();
      await options.store?.set(name, value);
      return value;
    };
    const manifest = await memo(`${key}/catalog`, () => collectCatalog(octokit, config, eligible, pinned));
    const documents = [];
    let unreadable = 0, actualBytes = 0;
    // Checkpoint fixed chunks instead of committing a growing copy of the entire
    // index for each file. Only an unfinished chunk (at most 16 files) is retried.
    for (let start = 0; start < manifest.catalog.length; start += 16) {
      const files = manifest.catalog.slice(start, start + 16);
      const chunkKey = `reading-chunk-v3/${hash({owner: config.owner, budget: config.charactersPerFile,
        maximum: config.maximumFileBytes, files: files.map(({repo,path,sha,size}) => ({repo,path,sha,size}))})}`;
      const chunk = await memo(chunkKey, () => indexFiles(octokit, config, files));
      unreadable += chunk.unreadable;
      actualBytes += chunk.byteLength;
      if (actualBytes > 50_000_000) throw Object.assign(new Error('Reading index exceeds capacity'), {code:'reading_capacity'});
      for (const document of chunk.documents) documents.push({...document,
        commit: pinned.find(r => r.repo === document.repo).commit});
    }
    const units = [];
    for (let depth = 0; documents.some(d => depth < d.parts.length); depth++)
      for (const document of documents) if (document.parts[depth]) units.push({document,depth});
    let context;
    const df = await memo(`${key}/terms`, async () => { context = indexContext(units); return [...context.df]; });
    index = { ...manifest, documents, units, context: context || indexContext(units, df),
      excluded: {...manifest.excluded, unreadable} };
    warmIndex = {key, index, durable:Boolean(options.store)};
  }
  return selectBatch(index, config, batch);
}

async function collectCatalog(octokit, config, eligible, pinned) {
  const repositories = [], catalog = [], seen = new Set();
  const excluded = { pathOrFormat: 0, oversized: 0, unreadable: 0 };
  let duplicateFiles = 0, declaredBytes = 0;
  const rank = path => {
    const i = (config.priorityPaths || []).indexOf(path);
    return i >= 0 ? i : /(^|\/)README\.md$/i.test(path) ? 100 : 200;
  };
  for (const pin of pinned) {
    const repo = pin.repo;
    const args = { owner: config.owner, repo };
    const { data: tree } = await octokit.git.getTree({ ...args, tree_sha: pin.tree, recursive: '1' });
    if (tree.truncated) throw Object.assign(new Error('Incomplete tree'), { code: 'truncated_tree' });
    const files = [];
    for (const file of tree.tree.filter(f => f.type === 'blob')) {
      if (file.mode !== '100644' || !eligible(file.path)) { excluded.pathOrFormat++; continue; }
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > config.maximumFileBytes) { excluded.oversized++; continue; }
      files.push(file);
    }
    files.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path, 'en'));
    repositories.push({ repo, commit: pin.commit, files });
  }
  for (let i = 0; repositories.some(r => i < r.files.length); i++) {
    for (const repo of repositories) {
      const file = repo.files[i];
      if (!file) continue;
      if (seen.has(file.sha)) { duplicateFiles++; continue; }
      seen.add(file.sha);
      declaredBytes += file.size;
      catalog.push({ ...file, repo: repo.repo, commit: repo.commit });
    }
  }
  // Refuse an oversized index explicitly rather than silently dropping its tail.
  if (catalog.length > 2000 || declaredBytes > 50_000_000)
    throw Object.assign(new Error('Reading index exceeds capacity'), { code: 'reading_capacity' });
  return {catalog, repositories: repositories.map(({repo,commit}) => ({repo,commit})), excluded, duplicateFiles};
}

async function indexFiles(octokit, config, files) {
  const documents = [];
  let unreadable = 0, byteLength = 0;
  for (const file of files) {
    let text;
    const { data: blob } = await octokit.git.getBlob({ owner: config.owner, repo: file.repo, file_sha: file.sha });
    if (blob.encoding !== 'base64') throw new Error('Unsupported source encoding');
    const bytes = Buffer.from(blob.content, 'base64');
    if (bytes.length > config.maximumFileBytes) throw new Error('Source exceeds configured limit');
    byteLength += bytes.length;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { unreadable++; continue; }
    if (text.includes('\0') || !text.trim()) { unreadable++; continue; }
    documents.push({ ...file, parts: completePassages(text, config.charactersPerFile).map(part => ({...part, terms: [...terms(part.text)]})) });
  }
  return {documents, unreadable, byteLength};
}

function selectBatch(index, config, batch) {
  const {units, documents, catalog, repositories, excluded, duplicateFiles} = index;
  const totalBatches = Math.ceil(units.length / config.filesPerBatch);
  const selected = units.slice((batch - 1) * config.filesPerBatch, batch * config.filesPerBatch);
  const selectedWindows = selected.length;
  const contextSelections = require('./context-windows').selectContext(units, selected, 4, index.context);
  for (const choice of contextSelections) selected.push(choice.unit);
  // Keep a second document available when only one long document remains.
  // This is at most one extra, explicitly repeated section, not a new source.
  if (selected.length && new Set(selected.map(u => u.document)).size === 1) {
    const anchor = units.find(u => u.document !== selected[0].document);
    if (anchor) selected.push(anchor);
  }
  const grouped = new Map();
  for (const { document: d, depth } of selected) {
    const key = `${d.repo}/${d.path}`;
    if (!grouped.has(key)) grouped.set(key, { id: `S${grouped.size + 1}`, repository: `${config.owner}/${d.repo}`,
      path: d.path, commit: d.commit, url: `https://github.com/${config.owner}/${d.repo}/blob/${d.commit}/${d.path.split('/').map(encodeURIComponent).join('/')}`,
      sampled: d.parts.length > 1, excerpts: [], windows: [], totalWindows: d.parts.length });
    const {terms: _terms, ...part} = d.parts[depth];
    grouped.get(key).excerpts.push(part);
    grouped.get(key).windows.push(depth + 1);
  }
  // Read source order, not retrieval rank. Supply each character at most once
  // within a source in this batch so context overlap cannot inflate word counts.
  for (const source of grouped.values()) {
    const unique=[];let coveredEnd=-1;
    for (const part of [...source.excerpts].sort((a,b)=>a.start-b.start)) {
      const trim=Math.max(0,coveredEnd-part.start);
      if(trim>=part.text.length)continue;
      unique.push({...part,start:part.start+trim,startLine:part.startLine+(part.text.slice(0,trim).match(/\n/g)||[]).length,text:part.text.slice(trim)});
      coveredEnd=Math.max(coveredEnd,part.end);
    }
    source.excerpts=unique;source.windows.sort((a,b)=>a-b);
  }
  return { mode: 'complete', batch, totalFiles: catalog.length, readableFiles: documents.length, totalBatches,
    totalWindows: units.length, selectedWindows, contextWindows: selected.length - selectedWindows, duplicateFiles, excluded,
    sources: [...grouped.values()], repositories: repositories.map(({ repo, commit }) => ({ repo, commit })),
    contextSelection: contextSelections.map(({unit,reason,sharedTerms})=>({repository:`${config.owner}/${unit.document.repo}`,
      path:unit.document.path,window:unit.depth+1,reason,sharedTerms})),
    settingsKey: settingsKey(config) };
}

function readingRecord(collected, nextBatch = collected.batch + 1) {
  return { version: 1, mode: 'complete', batch: collected.batch, nextBatch,
    totalBatches: collected.totalBatches, settingsKey: collected.settingsKey,
    repositories: collected.repositories,
    contextSelection: collected.contextSelection || [],
    sources: collected.sources.map(s => ({ id: s.id, repository: s.repository, path: s.path, commit: s.commit,
      ranges: s.excerpts.map(p => ({ start: p.start, end: p.end, startLine: p.startLine })) })) };
}

function parseReadingRecord(body, allowFinal = false) {
  const matches = [...body.matchAll(/<!-- complete-reading:([A-Za-z0-9+/=]+) -->/g)];
  if (matches.length !== 1 || matches[0][1].length > 30000) throw new Error('One completed reading record is required');
  const r = JSON.parse(Buffer.from(matches[0][1], 'base64').toString('utf8'));
  if (r.version !== 1 || r.mode !== 'complete' || !Number.isSafeInteger(r.nextBatch) || r.nextBatch < 1
    || !Number.isSafeInteger(r.totalBatches) || (!allowFinal && r.nextBatch > r.totalBatches) || r.nextBatch > 10000)
    throw new Error('No next reading batch');
  return r;
}

module.exports = { completePassages, collectCompleteSources, verifyPublicSources, settingsKey, validateSnapshot, readingRecord, parseReadingRecord };
