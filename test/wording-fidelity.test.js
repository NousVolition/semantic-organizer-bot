const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { skillsForMode } = require('../language-skills');
const { reviewIdea } = require('../idea-review');
const { auditConnections } = require('../comparison-audit');
const { citationPassages } = require('../discovery');
const { WORDING_FIDELITY_RULES } = require('../wording-fidelity');
const fixture = require('../fixtures/comparison-examples.json');
const marker = new Error('Stop after capturing the request; no live API call.');

test('timing and strength instructions reach review/discovery and the actual idea request', async () => {
  const markdown = readFileSync(join(__dirname, '../language-skills.md'), 'utf8');
  for (const mode of ['review', 'discovery']) {
    const selected = skillsForMode(markdown, mode);
    assert.ok(selected.includes(WORDING_FIDELITY_RULES));
    let captured = false;
    const client = { chat: { completions: { create: async request => {
      captured = true;
      assert.ok(request.messages.filter(x => x.role === 'system').some(x => x.content.includes(WORDING_FIDELITY_RULES)));
      assert.equal(request.messages.at(-1).content, 'The device could redirect the signal.');
      assert.doesNotMatch(JSON.stringify(request.messages), /Retains uncertain current ongoing action/);
      throw marker;
    } } } };
    await assert.rejects(reviewIdea(client, 'test', selected, 'The device could redirect the signal.'), e => e === marker);
    assert.equal(captured, true);
  }
});

test('the independent publication review receives the same fidelity rules without changing evidence', async () => {
  const connection = fixture.examples[0].connection;
  const catalog = citationPassages(fixture.sources);
  let captured = false;
  const client = { chat: { completions: { create: async request => {
    captured = true;
    assert.ok(request.messages.filter(x => x.role === 'system').some(x => x.content.includes(WORDING_FIDELITY_RULES)));
    const data = JSON.parse(request.messages[1].content);
    assert.equal(data.candidates[0].fields.relationship, connection.relationship);
    assert.ok(data.passages.every(p => catalog.some(q => q.id === p.id && q.quote === p.text)));
    assert.doesNotMatch(JSON.stringify(request.messages), /expectedAccept|expectedNotPass/);
    throw marker;
  } } } };
  await assert.rejects(auditConnections(client, 'test', [connection], catalog), e => e === marker);
  assert.equal(captured, true);
});

