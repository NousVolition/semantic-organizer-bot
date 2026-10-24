const { createHash } = require("node:crypto");
const { auditPublicationCandidates } = require('./publication-audit');
const { parseReadingRecord } = require('./complete-reading');
const { validConfidence } = require('./confidence');

function unescapeText(text) {
  return text.replace(/\\([\\`*_{}\[\]()#!|])/g, "$1")
    .replace(/&(lt|gt|amp);/g, (_, key) => ({ lt: "<", gt: ">", amp: "&" }[key]));
}

function parseReport(body) {
  const parts = body.split("## Sources and coverage")[0].split(/^## /m).slice(1);
  if (!parts.length || parts.length > 3) throw new Error("Unsupported discovery report size");
  const findings = [], skipped = [];
  for (const [i, part] of parts.entries()) {
    const header = /^([^\n]+)\n\*\*(observed|interpretive|creative) connection\*\*\n\n/.exec(part);
    if (!header) throw new Error("Unrecognized report section");
    if (part.includes("**Correction —")) { skipped.push(i + 1); continue; }
    const prose = part.slice(header[0].length).split(/^>/m)[0].trim();
    const [relationship, limit, extra] = prose.split("**Where the comparison stops:** ");
    if (!relationship?.trim() || !limit?.trim() || extra !== undefined) throw new Error("Incomplete comparison prose");
    const references = [...part.matchAll(/^((?:>[^\n]*(?:\n|$))+)\n\[(S\d+):[^\n]*\]\((https:\/\/github\.com\/[^\s)]+#L\d+)\)/gm)]
      .map(m => ({ source: m[2], url: m[3], renderedQuote: m[1].trimEnd().split("\n").map(line => line.replace(/^> ?/, "")).join("\n").trim() }));
    if (references.length < 2 || references.length > 4 || new Set(references.map(r => r.source)).size !== references.length)
      throw new Error("Invalid saved evidence references");
    const words = [...part.matchAll(/^- \*\*(.+?)\*\* \((candidate usage, not dictionary-verified|proposed coinage)\): (.+)$/gm)]
      .map(m => ({ term: unescapeText(m[1]), kind: m[2] === "proposed coinage" ? "coined" : "candidate", fit: unescapeText(m[3]) }));
    if (!words.length || words.length > 3) throw new Error("Invalid saved word suggestions");
    const tag = /\*\*Confidence: (High|Medium|Low|Not assessed)(?: \((lower|middle|upper)\))?\*\*[^\n]*\n\n\*\*Basis:\*\* ([\s\S]*?)\n\n\*\*To strengthen:\*\* ([\s\S]*?)\n\n\*\*To narrow:\*\* ([^\n]+)/.exec(part);
    const confidence = tag ? { level: tag[1] === 'Not assessed' ? 'not_assessed' : tag[1].toLowerCase(), band: tag[2] || 'none',
      basis: unescapeText(tag[3]), strengthen: unescapeText(tag[4]), pullBack: unescapeText(tag[5]) } : undefined;
    if (confidence && !validConfidence(confidence)) throw new Error('Invalid saved confidence');
    findings.push({ number: i + 1, references, connection: { title: unescapeText(header[1]), kind: header[2],
      relationship: unescapeText(relationship.trim()), limit: unescapeText(limit.trim()), words, ...(confidence ? { confidence } : {}) } });
  }
  return { findings, skipped };
}

function pinnedSource(reference, config, eligible) {
  const url = new URL(reference.url);
  const match = /^\/([^/]+)\/([^/]+)\/blob\/([0-9a-f]{40})\/(.+)$/.exec(url.pathname);
  if (url.origin !== "https://github.com" || url.search || !match || !/^#L[1-9]\d*$/.test(url.hash)) throw new Error("Unpinned source");
  const [, owner, repo, commit, encodedPath] = match;
  const path = decodeURIComponent(encodedPath);
  if (owner !== config.owner || !config.repositories.includes(repo) || !eligible(path)
    || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Source outside configured scope");
  return { id: reference.source, owner, repo, repository: `${owner}/${repo}`, path, commit,
    url: reference.url.split("#")[0] };
}

async function reviewPublishedReport({ octokit, config, reportIssue, openai, model, log, helpers }) {
  if (!Number.isSafeInteger(reportIssue) || reportIssue < 1) throw new Error("Invalid report issue");
  const params = { owner: config.owner, repo: config.controlRepository, issue_number: reportIssue };
  const marker = `<!-- semantic-discovery:${createHash("sha256").update(`${config.owner}/${config.controlRepository}#${reportIssue}`).digest("hex").slice(0, 16)} -->`;
  const comments = await octokit.paginate(octokit.issues.listComments, { ...params, per_page: 100 });
  const reports = comments.filter(c => c.user?.type === "Bot" && c.body?.includes(marker) && c.body.includes("# Language and connections"));
  if (reports.length !== 1) throw new Error("One completed bot report is required");
  const report = reports[0];
  const reading = report.body.includes('<!-- complete-reading:') ? parseReadingRecord(report.body, true) : null;
  const { findings, skipped } = parseReport(report.body.replace(/\r\n/g, "\n"));
  const sources = new Map();
  for (const finding of findings) for (const ref of finding.references) {
    const source = pinnedSource(ref, config, path => helpers.eligible(path, config.readingMode === 'complete'));
    if (sources.has(source.id) && sources.get(source.id).url !== source.url) throw new Error("Inconsistent source labels");
    sources.set(source.id, source);
  }
  // Check public visibility before any content read or model call.
  for (const repo of new Set([...sources.values()].map(s => s.repo))) {
    const { data } = await octokit.repos.get({ owner: config.owner, repo });
    if (data.private !== false || (data.visibility && data.visibility !== "public"))
      throw Object.assign(new Error("Private source requires a private reporting setup"), { code: "private_source" });
  }
  for (const source of sources.values()) {
    const { data } = await octokit.repos.getContent({ owner: source.owner, repo: source.repo, path: source.path, ref: source.commit });
    if (data.type !== "file" || data.encoding !== "base64" || data.size > config.maximumFileBytes) throw new Error("Unsupported pinned content");
    const bytes = Buffer.from(data.content, "base64");
    if (bytes.length > config.maximumFileBytes) throw new Error("Source exceeds size limit");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Binary source");
    source.sampled = text.length > config.charactersPerFile;
    if (reading) {
      const normalized = text.replace(/\r\n/g, '\n');
      const saved = reading.sources?.find(s => s.id === source.id && s.repository === source.repository && s.path === source.path && s.commit === source.commit);
      if (!saved || !Array.isArray(saved.ranges) || !saved.ranges.length || saved.ranges.length > 20) throw new Error('Missing complete-reading ranges');
      source.excerpts = saved.ranges.map(r => {
        if (!Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || r.start < 0 || r.end <= r.start
          || r.end > normalized.length || r.end - r.start > 8000) throw new Error('Invalid saved reading range');
        const startLine = 1 + (normalized.slice(0, r.start).match(/\n/g) || []).length;
        if (startLine !== r.startLine) throw new Error('Invalid saved source location');
        return { startLine, text: normalized.slice(r.start, r.end) };
      });
    } else source.excerpts = helpers.passages(text, config.charactersPerFile);
  }
  const catalog = helpers.citationPassages([...sources.values()]);
  for (const finding of findings) {
    finding.connection.evidence = Object.fromEntries([...sources.keys()].map(id => [id, null]));
    for (const ref of finding.references) {
      const match = catalog.find(p => p.source.id === ref.source && p.url === ref.url
        && helpers.safeText(p.quote).trim() === ref.renderedQuote);
      if (!match) throw Object.assign(new Error("Published citation no longer matches pinned sample"), { code: "unmatched_saved_citation" });
      finding.connection.evidence[ref.source] = match.id;
    }
  }
  const decisions = await auditPublicationCandidates(openai, model, findings.map(f => f.connection), catalog, log);
  const record = { version: 1, reportIssue, reportUrl: `https://github.com/${config.owner}/${config.controlRepository}/issues/${reportIssue}#issuecomment-${report.id}`,
    skippedCorrectedFindings: skipped,
    sources: [...sources.values()].map(({ id, repository, path, commit, url, sampled }) => ({ id, repository, path, commit, url, sampled })),
    results: findings.map((f, i) => ({ number: f.number, connection: f.connection, decision: decisions[i], citations: f.references.map(({ source, url }) => ({ source, url })) })) };
  return renderReview(record, helpers.safeText);
}

function renderReview(record, safeText) {
  const kept = record.results.filter(r => r.decision.accepted).length;
  const out = ["# Review of saved findings", `[Original report #${record.reportIssue}](${record.reportUrl})`,
    `${record.results.length} comparisons checked: ${kept} hold up under this review; ${record.results.length - kept} need qualification or more evidence.`,
    "The shared publication gate checked the existing title, explanation, limitation, confidence assessment when present and each term/fit against their pinned source passages. Context is limited to the original sampled passages or recorded complete-reading sections. These are fallible model judgments, not mathematical proofs or dictionary verification."];
  if (record.skippedCorrectedFindings.length) out.push(`Previously corrected findings skipped: ${record.skippedCorrectedFindings.join(", ")}.`);
  const label = { pass: "Pass", fail: "Needs correction", uncertain: "Uncertain" };
  for (const result of record.results) {
    const { connection: c, decision: d } = result;
    out.push(`\n## Finding ${result.number}: ${safeText(c.title, 120)}\n**${d.accepted ? "Holds up under this review" : "Needs qualification or more evidence"}**\n\n${safeText(d.reason, 1800)}`);
    for (const [key, title] of [["title", "Title"], ["relationship", "Connection"], ["limit", "Limits"]]) {
      const field = d.fields[key];
      out.push(`\n- **${title}: ${label[field.status]}** — ${safeText(field.reason, 450)}`);
    }
    for (const [i, word] of c.words.entries()) {
      const field = d.fields[`word_${i + 1}`];
      out.push(`\n- **${safeText(word.term, 90)}: ${label[field.status]}** — ${safeText(field.reason, 450)}`);
    }
    if (c.confidence) out.push(`\n- **Original confidence assessment: ${label[d.fields.confidence.status]}** — ${safeText(d.fields.confidence.reason, 450)}`);
    if (d.wordAudit) {
      for (const [key, field] of Object.entries(d.wordAudit.claimFields || {}))
        if (field.status !== 'pass') out.push(`\n- **Context of ${safeText(key)}: ${label[field.status]}** — ${safeText(field.reason, 600)}`);
      for (const [key, field] of Object.entries(d.wordAudit.fields || {}))
        if (field.status !== 'pass') out.push(`\n- **Meaning of ${safeText(key)}: ${label[field.status]}** — ${safeText(field.reason, 600)}`);
    }
    for (const ref of result.citations) out.push(`\n[Source ${ref.source}](${ref.url})`);
  }
  // Structured results are base64 encoded to keep raw model text out of Markdown/mentions.
  out.push(`\n<!-- comparison-review-data:${Buffer.from(JSON.stringify(record)).toString("base64")} -->`);
  const body = out.join("\n");
  if (body.length > 60000) throw Object.assign(new Error("Review exceeds comment limit"), { code: "review_too_large" });
  return body;
}

module.exports = { unescapeText, parseReport, pinnedSource, reviewPublishedReport, renderReview };
