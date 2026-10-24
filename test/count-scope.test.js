const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { skillsForMode } = require('../language-skills');
const { CHECKS, COMPARISON_RULES } = require('../comparison-audit');
const { citationPassages, checkComparisonExamples, createDiscoveryHandler } = require('../discovery');
const fixtures = require('../fixtures/count-examples.json');

function clientForExamples({ missTarget = false } = {}) {
  const requests = [];
  const client = { chat: { completions: { create: async request => {
    if(request.response_format.json_schema.name === 'word_meaning_audit') return require('./helpers/word-response')(request);
    const example = fixtures.examples[requests.length];
    requests.push(request);
    const { candidates, passages } = JSON.parse(request.messages[1].content);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].fields.relationship, example.connection.relationship);
    assert.ok(passages.every(p => example.connection.evidence[p.source]));
    assert.doesNotMatch(JSON.stringify(request.messages), /expectedAccept|expectedNotPass|expectedStances/);
    assert.match(request.messages[0].content, /counting unit/);
    assert.match(request.messages[0].content, /Missing member counts require uncertainty/);
    const fields = Object.fromEntries(Object.entries(candidates[0].fields).map(([key, proposition]) => [key, {
      stance: 'asserted', proposition,
      status: !missTarget && example.expectedNotPass?.includes(key) ? 'fail' : 'pass',
      reason: 'Supplied verdict for transport and gating validation, not live model comprehension.'
    }]));
    const checks = Object.fromEntries(CHECKS.map(key => [key, 'pass']));
    if (missTarget && !example.expectedAccept) checks.provenance = 'fail';
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      C1: { fields, checks, reason: 'Supplied test verdict.', passages: Object.values(example.connection.evidence) }
    }) } }] };
  } } } };
  return { client, requests };
}

test('the checked ledger reconciles groups, coverage and the included member', () => {
  const groups = fixtures.audit.groups;
  assert.equal(groups.reduce((n, [, body]) => n + body, 0), 42);
  assert.equal(groups.reduce((n, [, , refs]) => n + refs, 0), 4);
  assert.equal(groups.reduce((n, [, body, refs]) => n + body + refs, 0), 46);
  assert.deepEqual(groups.find(([term]) => term === 'Left / The Left'), ['Left / The Left', 21, 0]);
  assert.equal(groups.length, 8);
  const definitions = readFileSync(join(__dirname, '../corpus-definitions.md'), 'utf8');
  assert.match(definitions, /46 is the broader vocabulary count/);
  assert.match(definitions, /21 occurrences of “Left” are already included in 46/);
  assert.match(definitions, /27cef9a1d427263fbc2c6e9f93fe59224fcf0ee37824450d1002fb70f52f4f1d/);
});

test('both generation modes get count rules without losing unusual language or proof scope', () => {
  const rules = readFileSync(join(__dirname, '../language-skills.md'), 'utf8');
  for (const mode of ['review', 'discovery']) {
    const prompt = skillsForMode(rules, mode);
    assert.match(prompt, /Word counts and vocabulary groups/);
    assert.match(prompt, /do not invent a precise member count/);
    assert.match(prompt, /preserves Sens while adjusting Sin/);
    assert.match(prompt, /Withheld proof/);
    assert.match(prompt, /Do not downgrade the initial-field proof/);
  }
  assert.match(COMPARISON_RULES, /in EVERY field/);
  assert.match(COMPARISON_RULES, /Read denials, contextual headings and unusual metaphors in context/);
});

test('count probes have valid citations, paired controls and changed-version evidence', () => {
  const catalog = citationPassages(fixtures.sources);
  assert.equal(fixtures.examples.length, 12);
  assert.equal(fixtures.examples.filter(e => e.expectedAccept).length, 6);
  for (const example of fixtures.examples) {
    for (const [source, id] of Object.entries(example.connection.evidence))
      assert.ok(catalog.some(p => p.id === id && p.source.id === source), example.case);
  }
  const byCase = Object.fromEntries(fixtures.examples.map(e => [e.case, e]));
  assert.equal(byCase['count-metaphor-kept'].connection.words[0].term, 'lexical constellation');
  assert.equal(byCase['count-scopes-kept'].connection.title, 'Left vocabulary');
  assert.equal(byCase['count-denial-kept'].expectedAccept, true);
  assert.match(byCase['count-new-version-kept'].connection.relationship, /16 broader occurrences including 4 of Left/);
  assert.match(byCase['count-missing-member-kept'].connection.relationship, /not established/);
  // Existing proof/language and source-comparison suites remain unchanged.
  assert.equal(require('../fixtures/corpus-examples.json').examples.length, 14);
  assert.equal(require('../fixtures/comparison-examples.json').examples.length +
    require('../fixtures/scope-examples.json').examples.length, 22);
});

test('count evaluation runs 12 independent requests and keeps expected answers out', async () => {
  const { client, requests } = clientForExamples();
  const report = await checkComparisonExamples(client, 'mock-model', undefined, 'counts');
  assert.equal(requests.length, 12);
  assert.match(report, /12 of 12 expected decisions matched/);
  assert.match(report, /synthetic count-scope examples/);
  assert.match(report, /fixtures\/count-examples.json/);
  assert.doesNotMatch(report, /## Pinned sources/);
  const record = JSON.parse(Buffer.from(report.match(/comparison-example-data:([A-Za-z0-9+/=]+)/)[1], 'base64'));
  assert.deepEqual(record.results.map(r => r.actualAccept), fixtures.examples.map(e => e.expectedAccept));
  assert.ok(record.results.every(r => r.matched));
});

test('withholding for an unrelated reason does not pass a targeted count regression', async () => {
  const { client } = clientForExamples({ missTarget: true });
  const report = await checkComparisonExamples(client, 'mock-model', undefined, 'counts');
  assert.match(report, /6 of 12 expected decisions matched/);
  assert.match(report, /count-word-overclaim:[\s\S]*?Expected: withhold\. Actual: withhold\. \*\*FAIL\*\*/);
});

test('unknown suites fail before any API work', async () => {
  await assert.rejects(checkComparisonExamples({}, 'mock-model', undefined, 'unknown'), /Unknown comparison example suite/);
});

test('the count command remains owner-only and never collects repository files', async () => {
  const posted = [], updated = [];
  const octokit = { paginate: async () => [], issues: {
    listComments() {}, createComment: async x => { posted.push(x.body); return { data: { id: 1 } }; },
    updateComment: async x => updated.push(x.body)
  } };
  const config = { owner: 'example', controlRepository: 'bot', repositories: ['public'],
    filesPerBatch: 2, charactersPerFile: 600, maximumFileBytes: 10000 };
  const { client, requests } = clientForExamples();
  const handler = createDiscoveryHandler({ config, openai: client, model: 'mock-model', log: { error() {} } });
  const context = { octokit, issue: () => ({ owner: 'example', repo: 'bot', issue_number: 1 }),
    payload: { sender: { login: 'stranger', type: 'User' }, repository: { owner: { login: 'example' }, name: 'bot' },
      issue: { number: 1, title: '[Discover language] check count examples', user: { type: 'User' } } } };
  await handler.handle(context);
  assert.equal(posted.length, 0);
  context.payload.sender.login = 'example';
  context.payload.repository.name = 'wrong';
  await handler.handle(context);
  assert.equal(posted.length, 0);
  context.payload.repository.name = 'bot';
  await handler.handle(context);
  await handler.waitForIdle();
  assert.equal(requests.length, 12);
  assert.equal(updated.length, 1);
  assert.match(updated[0], /12 of 12 expected decisions matched/);
});
