const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const helpers = require("../discovery");
const { reviewFields, CHECKS } = require("../comparison-audit");
const { parseReport, pinnedSource, reviewPublishedReport } = require("../report-review");
const config = { owner: "example", controlRepository: "bot", repositories: ["alpha", "beta"],
  filesPerBatch: 2, charactersPerFile: 6000, maximumFileBytes: 10000 };
const texts = { alpha: "A record retains an earlier interpretation. See https://example.org/reference\nA different frame changes its role.",
  beta: "A trace retains effects of prior conditions.\nThis does not establish a common mechanism." };
const sources = Object.entries(texts).map(([repo, text], i) => ({ id: `S${i + 1}`, repository: `example/${repo}`, path: "notes.md",
  commit: String(i + 1).repeat(40), url: `https://github.com/example/${repo}/blob/${String(i + 1).repeat(40)}/notes.md`, excerpts: [{ startLine: 1, text }] }));
const connection = { title: "Earlier frames remain active", kind: "interpretive", relationship: "Both passages describe retained effects.",
  limit: "This is an analogy, not a shared mechanism.", evidence: { S1: "S1P1", S2: "S2P1" },
  words: [{ term: "frame trace", kind: "coined", fit: "Names the retained interpretive context." }] };
function state() {
  const marker = `<!-- semantic-discovery:${createHash("sha256").update("example/bot#45").digest("hex").slice(0, 16)} -->`;
  const body = marker + "\n" + helpers.renderDiscovery({ connections: [connection] }, { batch: 1, totalFiles: 2, totalBatches: 1, duplicateFiles: 0, sources });
  const comments = [{ id: 12, user: { type: "Bot" }, body }];
  const reads = []; let calls = 0;
  const octokit = { issues: { listComments() {} }, paginate: async () => comments,
    repos: { get: async () => ({ data: { private: false } }), getContent: async args => {
      reads.push(args); return { data: { type: "file", encoding: "base64", size: texts[args.repo].length, content: Buffer.from(texts[args.repo]).toString("base64") } };
    } } };
  const openai = { chat: { completions: { create: async request => {
    if(request.response_format.json_schema.name === 'word_meaning_audit') return require('./helpers/word-response')(request);
    calls++;
    assert.equal(request.response_format.json_schema.name, "comparison_audit");
    const candidates = JSON.parse(request.messages[1].content).candidates;
    const result = Object.fromEntries(candidates.map(c => [c.id, { fields: Object.fromEntries(Object.keys(c.fields).map(key => [key, { stance: "asserted", proposition: "A bounded claim about the stated evidence.", status: "pass", reason: "Supported in the supplied context." }])),
      checks: Object.fromEntries(CHECKS.map(key => [key, "pass"])), reason: "The bounded analogy holds.", passages: ["S1P1", "S2P1"] }]));
    return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] };
  } } } };
  return { comments, reads, get calls() { return calls; }, args: { octokit, config, reportIssue: 45, openai, model: "gpt-5.4-mini", helpers } };
}

test("saved report review preserves prose and pins original commits, including sanitized URL quotes", async () => {
  const s = state(); const report = await reviewPublishedReport(s.args);
  assert.equal(s.calls, 1);
  assert.deepEqual(s.reads.map(r => r.ref), sources.map(s => s.commit));
  const record = JSON.parse(Buffer.from(report.match(/comparison-review-data:([A-Za-z0-9+/=]+)/)[1], "base64"));
  assert.equal(record.results[0].connection.relationship, connection.relationship);
  assert.equal(record.results[0].connection.words[0].term, "frame trace");
  assert.equal(record.results[0].decision.fields.word_1.status, "pass");
  assert.equal(record.results[0].decision.accepted, true);
});

test('saved reports expose contextual rejection even when the old broad reviewer passes',async()=>{
  const s=state(),base=s.args.openai.chat.completions.create;
  let focusedCalls=0;
  s.args.openai.chat.completions.create=async request=>{
    const response=await base(request);
    if(request.response_format.json_schema.name==='word_meaning_audit'){
      focusedCalls++;
      const raw=JSON.parse(response.choices[0].message.content);
      raw.claimFields.relationship.support='unsupported';raw.claimFields.relationship.status='fail';
      raw.claimFields.relationship.reason='A record attribution was fused across different speakers.';
      response.choices[0].message.content=JSON.stringify(raw);
    }
    return response;
  };
  const report=await reviewPublishedReport(s.args);
  assert.equal(focusedCalls,1);
  const record=JSON.parse(Buffer.from(report.match(/comparison-review-data:([A-Za-z0-9+/=]+)/)[1],'base64'));
  assert.equal(record.results[0].decision.accepted,false);
  assert.match(report,/Context of relationship: Needs correction/);
  assert.match(report,/different speakers/);
});

test("tampered saved quotations and moved branch refs stop before the model runs", async () => {
  for (const mutate of [body => body.replace("A record retains", "A record erases"),
    body => body.replace(sources[0].commit, "main")]) {
    const s = state(); s.comments[0].body = mutate(s.comments[0].body);
    await assert.rejects(reviewPublishedReport(s.args)); assert.equal(s.calls, 0);
  }
});

test("private or out-of-scope sources are never read or sent to the model", async () => {
  const s = state(); s.args.octokit.repos.get = async () => ({ data: { private: true } });
  await assert.rejects(reviewPublishedReport(s.args), { code: "private_source" });
  assert.equal(s.reads.length, 0); assert.equal(s.calls, 0);
  for (const url of [sources[0].url.replace("example/alpha", "other/alpha") + "#L1", sources[0].url.replace("notes.md", "secrets/key.txt") + "#L1"])
    assert.throws(() => pinnedSource({ source: "S1", url }, config, helpers.eligible));
});

test("only a completed bot report with the expected marker can be reviewed", async () => {
  for (const mutate of [s => { s.comments[0].user.type = "User"; }, s => { s.comments.push({ ...s.comments[0] }); },
    s => { s.comments[0].body = s.comments[0].body.replace("semantic-discovery:", "another-marker:"); }]) {
    const s = state(); mutate(s); await assert.rejects(reviewPublishedReport(s.args)); assert.equal(s.calls, 0);
  }
});

test("dated editorial corrections are skipped rather than treated as original generated findings", async () => {
  const s = state(); s.comments[0].body = s.comments[0].body.replace("Both passages", "**Correction — 17 October 2026:** reviewed.\n\nBoth passages");
  assert.deepEqual(parseReport(s.comments[0].body).skipped, [1]);
  const report = await reviewPublishedReport(s.args);
  assert.equal(s.calls, 0); assert.match(report, /Previously corrected findings skipped: 1/);
});

test("the saved-report command retains the owner and reporting-repository boundary", async () => {
  let touched = false;
  const octokit = { paginate: async () => { touched = true; throw new Error("Should not read"); } };
  const context = { octokit, payload: { sender: { login: "other", type: "User" }, repository: { owner: { login: "example" }, name: "bot" },
    issue: { number: 100, title: "[Discover language] review report 45", user: { type: "User" } } } };
  const handler = helpers.createDiscoveryHandler({ config, log: { error() {} } });
  await handler.handle(context);
  context.payload.sender.login = "example"; context.payload.repository.name = "other";
  await handler.handle(context);
  assert.equal(touched, false);
});
