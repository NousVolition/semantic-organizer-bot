const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CHECKS, comparisonModel, reviewFields, auditSchema, evaluateAudit, auditConnections } = require("../comparison-audit");
const { citationPassages, generateDiscovery, checkComparisonExamples, createDiscoveryHandler } = require("../discovery");
const fixtures = require("../fixtures/comparison-examples.json");
const catalog = citationPassages(fixtures.sources);
const connections = fixtures.examples.map(x => x.connection);
const response = content => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 123, completion_tokens: 456 } });
function verdicts(items = connections) {
  return Object.fromEntries(items.map((c, i) => [`C${i + 1}`, {
    fields: Object.fromEntries(Object.keys(reviewFields(c)).map(key => [key, { stance: "asserted", proposition: "A bounded claim about the stated evidence.", status: "pass", reason: "This field stays within the evidence." }])),
    checks: Object.fromEntries(CHECKS.map(key => [key, "pass"])), reason: "Evidence is limited to the stated comparison.",
    passages: Object.values(c.evidence).filter(Boolean)
  }]));
}
function requestVerdicts(request) {
  const { candidates } = JSON.parse(request.messages[1].content);
  assert.ok(!request.messages[1].content.includes('expectedNotPass'));
  assert.ok(!request.messages[1].content.includes('expectedStances'));
  assert.equal(candidates.length, 1);
  return Object.fromEntries(candidates.map(c => [c.id, {
    fields: Object.fromEntries(Object.keys(c.fields).map(key => [key, { stance: key === 'word_3' ? 'contrast' : 'asserted',
      proposition: 'The complete field preserves the stated scope.', status: 'pass', reason: 'Mock supported field.' }])),
    checks: Object.fromEntries(CHECKS.map(key => [key, 'pass'])), reason: 'Mock supported comparison.',
    passages: Object.values(c.evidence).filter(Boolean)
  }]));
}

test('missing assertion readings fail closed without keyword-based acceptance', () => {
  for (const change of [field => delete field.stance, field => field.stance = 'not', field => delete field.proposition, field => field.proposition = ' ']) {
    const review = verdicts(); change(review.C1.fields.word_1);
    const result = evaluateAudit(connections, review, catalog)[0];
    assert.equal(result.accepted, false); assert.ok(result.failed.includes('word_1'));
  }
  const review = verdicts();
  review.C1.fields.word_1 = { stance: 'withheld', proposition: 'Proof of evolution is not established.', status: 'fail', reason: 'A separate unsupported assertion remains.' };
  assert.equal(evaluateAudit(connections, review, catalog)[0].accepted, false);
});

test('each candidate schema excludes citations from other candidates', () => {
  const schema = auditSchema(connections, catalog);
  assert.ok(schema.properties.C1.properties.passages.items.enum.includes('S1P1'));
  assert.ok(!schema.properties.C1.properties.passages.items.enum.includes('S5P1'));
  assert.ok(schema.properties.C5.properties.passages.items.enum.includes('S5P1'));
});

test('scope examples contain valid evidence and both positive and negative controls', () => {
  const scope = require('../fixtures/scope-examples.json');
  const passages = citationPassages(scope.sources);
  assert.equal(scope.examples.length, 16);
  assert.equal(scope.examples.filter(e => e.expectedAccept).length, 8);
  for (const e of scope.examples) for (const [source,id] of Object.entries(e.connection.evidence))
    assert.ok(passages.some(p => p.id === id && p.source.id === source));
  assert.deepEqual(scope.examples.find(e => e.case === 'unsaved-state-preservation').expectedNotPass, ['relationship','word_2']);
  assert.equal(scope.examples.find(e => e.case === 'proof-explicitly-withheld').expectedAccept, true);
  assert.equal(scope.examples.find(e => e.case === 'not-only-is-affirmative').expectedAccept, false);
});

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
  for (const example of fixtures.examples) {
    const fields = Object.values(reviewFields(example.connection)).join("\n");
    for (const [sourceId] of fields.matchAll(/\bS\d+\b/g))
      assert.ok(example.connection.evidence[sourceId], `Fixture refers to an unrelated source: ${sourceId}`);
  }
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
  const entries = []; let calls = 0;
  const client = { chat: { completions: { create: async request => {
    const data = JSON.parse(request.messages[1].content);
    assert.ok(!request.messages[1].content.includes("expectedAccept"));
    assert.deepEqual(Object.keys(request.response_format.json_schema.schema.properties), ["C1"]);
    const c = connections[calls++];
    assert.equal(data.candidates[0].fields.title, c.title);
    assert.ok(data.passages.every(p => c.evidence[p.source]));
    assert.ok(data.passages.length > Object.values(c.evidence).filter(Boolean).length);
    assert.equal(request.model, 'gpt-5.4');
    assert.equal(request.max_completion_tokens, 12000);
    assert.equal(request.reasoning_effort, 'medium');
    assert.equal(request.temperature, undefined);
    return response(requestVerdicts(request));
  } } } };
  await auditConnections(client, "gpt-5.4-mini", connections, catalog, { info: (...args) => entries.push(args) });
  assert.equal(calls, 6); assert.equal(entries.length, 12);
  assert.ok(!JSON.stringify(entries).includes("coordinate transform"));
  assert.ok(!JSON.stringify(entries).includes("Evidence is limited"));
});

test("a failed comparison never reaches the published discovery report", async () => {
  const items = connections.slice(0, 2);
  let calls = 0;
  const client = { chat: { completions: { create: async request => {
    calls++;
    if (request.response_format.json_schema.name === "language_discovery") {
      assert.equal(request.model, 'gpt-5.4-mini');
      return response({ connections: items });
    }
    assert.equal(request.model, 'gpt-5.4');
    const review = requestVerdicts(request);
    if (JSON.parse(request.messages[1].content).candidates[0].fields.title === items[0].title) review.C1.checks.provenance = "fail";
    return response(review);
  } } } };
  const report = await generateDiscovery(client, "gpt-5.4-mini", "", { batch: 1, totalFiles: 6, totalBatches: 1, duplicateFiles: 0, sources: fixtures.sources });
  assert.equal(calls, 3);
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
    return request.response_format.json_schema.name === "language_discovery" ? response({ connections: [] }) : response(requestVerdicts(request));
  } } } };
  await generateDiscovery(client, "gpt-5.4-mini", "", { batch: 1, totalFiles: 6, totalBatches: 1, duplicateFiles: 0, sources: fixtures.sources });
  assert.equal(calls, 1);
  const report = await checkComparisonExamples(client, "gpt-5.4-mini");
  assert.match(report, /11 of 22 expected decisions matched/);
  assert.equal((report.match(/\*\*FAIL\*\*/g) || []).length, 11);
  assert.equal(calls, 23);
  const record = JSON.parse(Buffer.from(report.match(/comparison-example-data:([A-Za-z0-9+/=]+)/)[1], 'base64'));
  assert.equal(record.total, 22); assert.equal(record.passed, 11);
  assert.equal(record.model, 'gpt-5.4');
});

test('comparison model override stays separate from the discovery model', () => {
  const previous = process.env.COMPARISON_MODEL;
  try {
    delete process.env.COMPARISON_MODEL;
    assert.equal(comparisonModel('gpt-5.4-mini'), 'gpt-5.4');
    assert.equal(comparisonModel('custom-model'), 'custom-model');
    process.env.COMPARISON_MODEL = ' gpt-5.4-mini ';
    assert.equal(comparisonModel('gpt-5.4-mini'), 'gpt-5.4-mini');
  } finally {
    if (previous === undefined) delete process.env.COMPARISON_MODEL;
    else process.env.COMPARISON_MODEL = previous;
  }
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
  const openai = { chat: { completions: { create: async request => { calls++; return response(requestVerdicts(request)); } } } };
  const handler = createDiscoveryHandler({ octokitForContext: () => octokit, config, openai, model: "gpt-5.4-mini", log: { error() {} } });
  await handler.handle(context); assert.equal(calls, 0); assert.equal(posted.length, 0);
  context.payload.sender.login = "example"; context.payload.repository.name = "other";
  await handler.handle(context); assert.equal(posted.length, 0);
  context.payload.repository.name = "bot";
  await handler.handle(context); await handler.waitForIdle();
  assert.equal(calls, 22); assert.match(updated[0], /Comparison regression check/);
});

test('rejecting a bad example for the wrong reason does not pass its targeted regression check', async () => {
  const all = [...fixtures.examples, ...require('../fixtures/scope-examples.json').examples];
  let offset = 0;
  const client = { chat: { completions: { create: async request => {
    const result = requestVerdicts(request);
    for (const value of Object.values(result)) {
      if (!all[offset++].expectedAccept) value.checks.provenance = 'fail';
    }
    return response(result);
  } } } };
  const report = await checkComparisonExamples(client, 'gpt-5.4-mini');
  const record = JSON.parse(Buffer.from(report.match(/comparison-example-data:([A-Za-z0-9+/=]+)/)[1], 'base64'));
  const preservation = record.results.find(r => r.case === 'unsaved-state-preservation');
  assert.equal(preservation.actualAccept, false); assert.equal(preservation.matched, false);
});
