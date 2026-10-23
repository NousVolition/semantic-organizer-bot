const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { skillsForMode } = require('../language-skills');
const { validConfidence, renderConfidence } = require('../confidence');
const { checkComparisonExamples, citationPassages, safeText } = require('../discovery');
const { CHECKS, evaluateAudit, reviewFields } = require('../comparison-audit');
const fixture = require('../fixtures/support-examples.json');

test('support rules reach both modes without forcing praise or erasing withheld proof', () => {
  const skills = readFileSync(join(__dirname, '../language-skills.md'), 'utf8');
  for (const mode of ['review','discovery']) {
    const prompt = skillsForMode(skills, mode);
    for (const phrase of ['Understatement and grounded encouragement', 'deliberate understatement', 'preserves Sens while adjusting Sin', 'not a calibrated probability', 'zero eligible pairs', 'Reset is not necessarily recovery']) assert.ok(prompt.includes(phrase), phrase);
  }
  assert.match(skillsForMode(skills,'review'), /brief grounded strength or optional understatement revision/);
});
test('confidence bands and explanations are required; absence is never fabricated as high', () => {
  const c = fixture.examples.at(-1).connection.confidence;
  for (const band of ['lower','middle','upper']) {
    assert.ok(validConfidence({ ...c, band }));
    assert.match(renderConfidence({ ...c, band }, safeText), new RegExp(`Medium \\(${band}\\)`));
  }
  for (const invalid of [{...c,band:'none'},{...c,level:'high'},{...c,basis:''}]) assert.ok(!validConfidence(invalid));
  assert.match(renderConfidence(undefined,safeText), /Not assessed/);
});
test('the confidence field participates in publication gating', () => {
  const connection = fixture.examples.find(e => e.case === 'confidence-alone-overclaims').connection;
  const fields = Object.fromEntries(Object.entries(reviewFields(connection)).map(([k, proposition]) => [k,{stance:'asserted',proposition,status:k==='confidence'?'fail':'pass',reason:'Test verdict.'}]));
  const [d] = evaluateAudit([connection], {C1:{fields,checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),reason:'Unsupported confidence.',passages:['S307P1','S308P1']}}, citationPassages(fixture.sources));
  assert.equal(d.accepted,false); assert.ok(d.failed.includes('confidence'));
});
test('12 support probes run separately without expected-answer leakage', async () => {
  let calls=0;
  const client={chat:{completions:{create:async r=>{
    const expected=fixture.examples[calls++];
    assert.doesNotMatch(JSON.stringify(r.messages), /expectedAccept|expectedNotPass/);
    assert.match(r.messages[0].content,/qualitative, fallible assessment/);
    const data=JSON.parse(r.messages[1].content);
    assert.equal(data.candidates.length,1);
    assert.equal(data.candidates[0].fields.relationship,expected.connection.relationship);
    const fields=Object.fromEntries(Object.entries(data.candidates[0].fields).map(([k,proposition])=>[k,{stance:'asserted',proposition,status:expected.expectedNotPass?.includes(k)?'fail':'pass',reason:'Transport-test verdict, not live model evidence.'}]));
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:{fields,checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),reason:'Test verdict.',passages:Object.values(expected.connection.evidence)}})}}]};
  }}}};
  const report=await checkComparisonExamples(client,'test',undefined,'support');
  assert.equal(calls,12); assert.match(report,/12 of 12 expected decisions matched/);
  assert.match(report,/fixtures\/support-examples.json/);
  assert.equal(fixture.examples.filter(e=>e.expectedAccept).length,6);
  for(const e of fixture.examples) assert.ok(validConfidence(e.connection.confidence));
});
