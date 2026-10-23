const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { skillsForMode } = require('../language-skills');
const { reviewIdea } = require('../idea-review');
const { generateDiscovery, citationPassages } = require('../discovery');
const { auditConnections, CHECKS } = require('../comparison-audit');
const { SEMANTIC_LENSES, SEMANTIC_CHECKS } = require('../semantic-lenses');
const fixture = require('../fixtures/comparison-examples.json');

test('all reading entry points and the independent reviewer receive the shared lenses', async () => {
  const markdown = readFileSync(join(__dirname, '../language-skills.md'), 'utf8');
  const stop = new Error('Captured only: this verifies wiring, not model understanding.');
  let requests = 0;
  const client = { chat: { completions: { create: async request => {
    requests++;
    assert.ok(request.messages.some(m => m.role === 'system' && m.content.includes(SEMANTIC_LENSES)));
    assert.doesNotMatch(JSON.stringify(request.messages), /expectedAccept|expectedNotPass/);
    throw stop;
  } } } };
  for (const mode of ['review', 'discovery']) {
    const skills = skillsForMode(markdown, mode);
    assert.ok(skills.includes(SEMANTIC_LENSES));
    await assert.rejects(reviewIdea(client, 'test', skills, 'A membership cue need not be exclusion.'), e => e === stop);
  }
  await assert.rejects(generateDiscovery(client, 'test', skillsForMode(markdown, 'discovery'),
    { sources: fixture.sources, coverage: [] }), e => e === stop);
  await assert.rejects(auditConnections(client, 'test', [fixture.examples[0].connection], citationPassages(fixture.sources)), e => e === stop);
  assert.equal(requests, 4);
  assert.ok(SEMANTIC_CHECKS.every(k => CHECKS.includes(k)));
});
