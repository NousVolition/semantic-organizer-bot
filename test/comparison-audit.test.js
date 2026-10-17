const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CHECKS, reviewFields, evaluateAudit, auditConnections } = require("../comparison-audit");
const { citationPassages, generateDiscovery, checkComparisonExamples, createDiscoveryHandler } = require("../discovery");
const fixtures = require("../fixtures/comparison-examples.json");
const catalog = citationPassages(fixtures.sources);
const connections = fixtures.examples.map(x => x.connection);
const response = content => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 123, completion_tokens: 456 } });
function verdicts(items = connections) {
  return Object.fromEntries(items.map((c, i) => [`C${i + 1}`, {
    fields: Object.fromEntries(Object.keys(reviewFields(c)).map(key => [key, { status: "pass", reason: "This field stays within the evidence." }])),
    checks: Object.fromEntries(CHECKS.map(key => [key, "pass"])), reason: "Evidence is limited to the stated comparison.",
    passages: Object.values(c.evidence).filter(Boolean)
  }]));
}

test("each comparison dimension independently blocks publication; uncertainty never becomes acceptance", () => {
  for (const key of CHECKS) for (const status of ["fail", "uncertain", undefined]) {
    const review = verdicts();
    review.C1.checks[key] = status;
    const decisions = evaluateAudit(connections, review, catalog);
    assert.equal(decisions[0].accepted, false, `${key}/${status}`);
    assert.ok(decisions[0].failed.includes(key));
    assert.ok(decisions.slice(1).every(d => d.accepted));
  }
});

test("missing decisions, unknown citations and citations borrowed from another comparison fail closed", () => {
  for (const value of [undefined, { ...verdicts().C1, passages: ["S99P1"] },
    { ...verdicts().C1, passages: ["S5P1"] }, { ...verdicts().C1, passages: [] },
    { ...verdicts().C1, reason: "" }]) {
    const review = verdicts(); review.C1 = value;
    assert.equal(evaluateAudit(connections, review, catalog)[0].accepted, false);
  }
});

test("a true relationship cannot hide a false limit, invented chronology or an overclaiming term", () => {
  for (const field of ["title", "relationship", "limit", "word_1", "word_2", "word_3"]) {
    for (const status of ["fail", "uncertain", undefined]) {
      const review = verdicts();
      review.C1.fields[field] = status ? { status, reason: "This individual claim is unsupported." } : undefined;
      const decisions = evaluateAudit(connections, review, catalog);
      assert.equal(decisions[0].accepted, false, `${field}/${status}`);
      assert.ok(decisions[0].failed.includes(field));
      assert.ok(decisions[1].accepted);
    }
  }
});

test("regression cases retain real values, version context, and valid same-study/contrast controls", () => {
  assert.equal(fixtures.examples.length, 6);
  assert.deepEqual(fixtures.examples.map(x => x.expectedAccept), [false, true, false, true, false, true]);
  const text = fixtures.sources.flatMap(s => s.excerpts.map(p => p.text)).join("\n");
  for (const needle of ["coordinate transform", "0.053709416", "**0 after**", "GFN1-xTB", "GFN2-xTB", "-5.768774918844", "-5.070544446870"])
    assert.ok(text.includes(needle), needle);
  const review = verdicts();
  review.C1.checks.provenance = "fail";
  review.C3.checks.configuration = "fail";
  review.C5.checks.quantities = "fail";
  assert.deepEqual(evaluateAudit(connections, review, catalog).map(d => d.accepted), fixtures.examples.map(x => x.expectedAccept));
});

test("review sees adjacent context, not expected answers, and logs only counts/categories", async () => {
  const entries = [];
  const client = { chat: { completions: { create: async request => {
    const data = JSON.parse(request.messages[1].content);
    assert.ok(!request.messages[1].content.includes("expectedAccept"));
    assert.deepEqual(Object.keys(request.response_format.json_schema.schema.properties), ["C1", "C2", "C3", "C4", "C5", "C6"]);
    assert.ok(data.passages.some(p => p.text.includes("coordinate transform")));
    assert.ok(data.passages.some(p => p.text.includes("GFN1-xTB")));
    assert.ok(data.passages.some(p => p.text.includes("**0 after**")));
    assert.equal(request.max_completion_tokens, 12000);
    assert.equal(request.temperature, undefined);
    return response(verdicts());
  } } } };
  await auditConnections(client, "gpt-5.4-mini", connections, catalog, { info: (...args) => entries.push(args) });
  assert.equal(entries.length, 2);
  assert.ok(!JSON.stringify(entries).includes("coordinate transform"));
  assert.ok(!JSON.stringify(entries).includes("Evidence is limited"));
});

test("a failed comparison never reaches the published discovery report", async () => {
  const items = connections.slice(0, 2);
  let calls = 0;
  const client = { chat: { completions: { create: async request => {
    calls++;
    if (request.response_format.json_schema.name === "language_discovery") return response({ connections: items });
    const review = verdicts(items); review.C1.checks.provenance = "fail";
    return response(review);
  } } } };
  const report = await generateDiscovery(client, "gpt-5.4-mini", "", { batch: 1, totalFiles: 6, totalBatches: 1, duplicateFiles: 0, sources: fixtures.sources });
  assert.equal(calls, 2);
  assert.ok(!report.includes(items[0].title));
  assert.ok(report.includes(items[1].title));
  assert.match(report, /1 of 2 proposals were withheld/);
});

test("incomplete, refused or malformed audit responses cannot publish the draft", async () => {
  for (const reviewResponse of [
    { choices: [{ finish_reason: "length", message: { content: "{}" } }] },
    { choices: [{ finish_reason: "stop", message: { refusal: "private provider detail" } }] },
    { choices: [{ finish_reason: "stop", message: { content: "{" } }] }
  ]) {
    const client = { chat: { completions: { create: async request => request.response_format.json_schema.name === "language_discovery"
      ? response({ connections: [connections[0]] }) : reviewResponse } } };
    await assert.rejects(generateDiscovery(client, "gpt-5.4-mini", "", { sources: fixtures.sources }));
  }
});

test("an empty draft spends no review call; example checks report mismatches honestly", async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async request => {
    calls++;
    return request.response_format.json_schema.name === "language_discovery" ? response({ connections: [] }) : response(verdicts());
  } } } };
  await generateDiscovery(client, "gpt-5.4-mini", "", { batch: 1, totalFiles: 6, totalBatches: 1, duplicateFiles: 0, sources: fixtures.sources });
  assert.equal(calls, 1);
  const report = await checkComparisonExamples(client, "gpt-5.4-mini");
  assert.match(report, /3 of 6 expected decisions matched/);
  assert.equal((report.match(/\*\*FAIL\*\*/g) || []).length, 3);
  assert.equal(calls, 2);
});

test("example-check command obeys owner/repository authorization and avoids repository collection", async () => {
  let calls = 0; const posted = [], updated = [];
  const octokit = { paginate: async () => [], issues: { listComments() {},
    createComment: async args => { posted.push(args.body); return { data: { id: 1 } }; },
    updateComment: async args => updated.push(args.body) } };
  const config = { owner: "example", controlRepository: "bot", repositories: ["public"], filesPerBatch: 2, charactersPerFile: 600, maximumFileBytes: 10000 };
  const context = { octokit, issue: () => ({ owner: "example", repo: "bot", issue_number: 1 }),
    payload: { sender: { login: "stranger", type: "User" }, repository: { owner: { login: "example" }, name: "bot" },
      issue: { number: 1, title: "[Discover language] check examples", user: { type: "User" } } } };
  const openai = { chat: { completions: { create: async () => { calls++; return response(verdicts()); } } } };
  const handler = createDiscoveryHandler({ octokitForContext: () => octokit, config, openai, model: "gpt-5.4-mini", log: { error() {} } });
  await handler.handle(context); assert.equal(calls, 0); assert.equal(posted.length, 0);
  context.payload.sender.login = "example"; context.payload.repository.name = "other";
  await handler.handle(context); assert.equal(posted.length, 0);
  context.payload.repository.name = "bot";
  await handler.handle(context); await handler.waitForIdle();
  assert.equal(calls, 1); assert.match(updated[0], /Comparison regression check/);
});
