const { createHash } = require('node:crypto');

function invalid() { return Object.assign(new Error('Invalid pinned source request'), { code: 'invalid_sources' }); }
function parseSourceRequest(body, config, eligible) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 24000) throw invalid();
  let request;
  try { request = JSON.parse(body.replace(/^```json\s*\n([\s\S]*?)\n```\s*$/, '$1')); } catch { throw invalid(); }
  if (!request || Object.keys(request).some(k => !['sources', 'proposals'].includes(k))
    || !Array.isArray(request.sources) || request.sources.length < 2 || request.sources.length > 4
    || (request.proposals !== undefined && (!Array.isArray(request.proposals) || request.proposals.length > 3))) throw invalid();
  const sources = request.sources.map((raw, i) => {
    if (typeof raw !== 'string') throw invalid();
    let u; try { u = new URL(raw); } catch { throw invalid(); }
    const m = /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/(.+)$/.exec(u.pathname);
    if (u.origin !== 'https://github.com' || u.username || u.password || u.search || u.hash || !m) throw invalid();
    const [, owner, repo, commit, encodedPath] = m;
    let path; try { path = decodeURIComponent(encodedPath); } catch { throw invalid(); }
    if (owner !== config.owner || ![...config.repositories, config.controlRepository].includes(repo)
      || path.length > 500 || path.includes('\\') || path.split('/').some(x => !x || x === '.' || x === '..')
      || !eligible(path, true)) throw invalid();
    return { id: `S${i + 1}`, owner, repo, repository: `${owner}/${repo}`, path, commit,
      url: `https://github.com/${owner}/${repo}/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}` };
  });
  if (new Set(sources.map(s => s.url)).size !== sources.length) throw invalid();
  return { sources, proposals: request.proposals || [] };
}

async function collectPinnedSources(octokit, request, config) {
  // Inspect every repository's visibility before reading any source content.
  for (const repo of new Set(request.sources.map(s => s.repo))) {
    const { data } = await octokit.repos.get({ owner: config.owner, repo });
    if (data.private !== false || (data.visibility && data.visibility !== 'public'))
      throw Object.assign(new Error('Private source'), { code: 'private_source' });
  }
  const sources = [];
  for (const source of request.sources) {
    const { data } = await octokit.repos.getContent({ owner: source.owner, repo: source.repo, path: source.path, ref: source.commit });
    if (data.type !== 'file' || data.encoding !== 'base64' || data.size > Math.min(24000, config.maximumFileBytes)) throw invalid();
    const bytes = Buffer.from(data.content, 'base64');
    if (bytes.length > Math.min(24000, config.maximumFileBytes)) throw invalid();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n');
    if (!text.trim() || text.includes('\0') || text.length > config.charactersPerFile) throw invalid();
    sources.push({ ...source, sampled: false, contentSha256: createHash('sha256').update(text).digest('hex'), excerpts: [{ startLine: 1, text }] });
  }
  if (new Set(sources.map(s => s.contentSha256)).size !== sources.length) throw invalid();
  return { mode: 'pinned', batch: 1, totalBatches: 1, totalFiles: sources.length, duplicateFiles: 0, sources };
}

function validateProposals(proposals, catalog, validConfidence) {
  const text = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
  for (const p of proposals) {
    if (!p || Object.keys(p).some(k => !['title','kind','relationship','limit','words','confidence','evidence'].includes(k))
      || !text(p.title,120) || !text(p.relationship,1500) || !text(p.limit,1500)
      || !['observed','interpretive','creative'].includes(p.kind)
      || !Array.isArray(p.words) || !p.words.length || p.words.length > 3
      || p.words.some(w => !w || Object.keys(w).some(k => !['term','kind','fit'].includes(k))
        || !text(w.term,90) || !text(w.fit,500) || !['coined','candidate'].includes(w.kind))
      || (p.confidence !== undefined && !validConfidence(p.confidence))
      || !p.evidence || typeof p.evidence !== 'object' || Array.isArray(p.evidence)) throw invalid();
    const entries = Object.entries(p.evidence);
    if (entries.some(([source,id]) => !catalog.some(q => q.source.id === source)
      || (id !== null && !catalog.some(q => q.id === id && q.source.id === source && q.quote.length >= 15)))
      || entries.filter(([,id]) => id !== null).length < 2) throw invalid();
  }
}
module.exports = { parseSourceRequest, collectPinnedSources, validateProposals };
