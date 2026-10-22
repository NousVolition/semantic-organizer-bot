const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { CORPUS_GUIDANCE } = require('../corpus-knowledge');
const { skillsForMode } = require('../language-skills');
const { auditConnections, CHECKS } = require('../comparison-audit');
const { citationPassages, checkComparisonExamples, createDiscoveryHandler } = require('../discovery');
const fixtures = require('../fixtures/corpus-examples.json');
const catalog = citationPassages(fixtures.sources);

test('the same local definitions reach both generation modes and the independent audit', async () => {
  const rules = readFileSync(join(__dirname, '../language-skills.md'), 'utf8');
  for (const mode of ['review','discovery']) {
    const prompt = skillsForMode(rules, mode);
    assert.equal(prompt.split(CORPUS_GUIDANCE).length, 2);
    assert.match(prompt, /do not impose them on unrelated writing/);
    assert.match(prompt, /partial_x\(u0_x\) \+ partial_y\(u0_y\) = -A\*H\*C\*phi/);
    assert.match(prompt, /Do not downgrade the initial-field proof/);
    assert.match(prompt, /standard local-existence theory/);
  }
  let calls = 0;
  const client = { chat: { completions: { create: async req => {
    calls++;
    assert.equal(req.messages[0].content.split(CORPUS_GUIDANCE).length, 2);
    assert.doesNotMatch(JSON.stringify(req.messages), /expectedAccept|expectedNotPass|expectedStances/);
    assert.match(req.messages[0].content, /withholding a claim of proof is not asserting that proof/);
    assert.match(req.messages[0].content, /Checked initial-field proof and its scope/);
    return { choices: [{ finish_reason:'stop', message:{ content:'{}' } }] };
  } } } };
  const result = await auditConnections(client, 'mock-model', [fixtures.examples[0].connection], catalog);
  assert.equal(calls, 1);
  assert.equal(result[0].accepted, false);
});

test('numerical counterexamples distinguish threshold semantics and composition regularity', () => {
  const eps = 2;
  const tail = q => q * (1 + Math.tanh(q/eps)) / 2;
  assert.ok(Math.abs(tail(-eps)/eps + .11920292202211755) < 1e-14);
  assert.ok(tail(-eps) < 0);
  assert.equal(Math.max(-eps,0),0);
  assert.equal(Math.max(0,0),0);
  // Difference quotients expose a corner in this actual composition (not all compositions).
  const f = v => tail(Math.abs(v) - eps);
  const h=1e-5, right=(f(h)-f(0))/h, left=(f(-h)-f(0))/(-h);
  assert.ok(Math.abs(right-left) > .1);
  const delta=.3, gamma=2;
  const norm = v => Math.sqrt(v*v+delta*delta)-delta;
  const onset = Math.sqrt(gamma*gamma+2*delta*gamma);
  assert.ok(Math.abs(norm(onset)-gamma)<1e-12);
  assert.equal(norm(0),0);
  assert.ok(norm(gamma)<gamma); // A changed measure shifts the original-magnitude threshold.
  const calibrated = v => Math.sqrt(v*v+delta*delta)-Math.sqrt(gamma*gamma+delta*delta);
  assert.equal(calibrated(gamma),0);
  assert.ok(calibrated(gamma/2)<0);
  assert.ok(calibrated(gamma*2)>0);
  // These finite checks illustrate the guidance; they are not a proof of C-infinity.
  const exact = q => q <= 0 ? 0 : q*Math.exp(-((eps/q)**2));
  for (const q of [-2,-.1,0]) assert.equal(exact(q),0);
  assert.ok(exact(2)>0);
});

test('counterexamples keep feasibility, dissipation and static invariance in scope', () => {
  const actions=[0], boundary=[-1,1];
  assert.ok(actions.some(x => x>=-1 && x<=1));
  assert.ok(!actions.some(x => boundary.includes(x)));
  assert.equal(Math.min(...boundary.map(x=>Math.abs(2-x))),1);
  const pairs=[[1,1],[1,0],[0,1],[0,0]];
  assert.deepEqual(pairs.map(([a,b])=>a===b),[true,false,false,true]);
  const severity=[.8,1.4,1.3].map(x=>5*x), thresholds=[8.5,5.5,6];
  assert.deepEqual(severity,[4,7,6.5]);
  assert.deepEqual(severity.map((x,i)=>x>=thresholds[i]),[false,true,true]);
  const s=3,r=5,lambda=2;
  assert.equal((lambda*s)*(r/lambda),s*r);
  // Zero coordinate residual at t=0 is compatible with x'=x-3 and growing perturbations.
  assert.equal(3-3,0);
  assert.ok(.01*Math.exp(1)>.01);
  // Fixed negative force adds energy to a negative velocity: u dot f > 0.
  assert.ok((-1)*(-1)>0);
});

test('corpus evaluation has matched controls, valid evidence, and no answer leakage', async () => {
  assert.equal(fixtures.examples.length,14);
  assert.equal(fixtures.examples.filter(x=>x.expectedAccept).length,7);
  for(const e of fixtures.examples) for(const [source,id] of Object.entries(e.connection.evidence))
    assert.ok(catalog.some(p=>p.id===id && p.source.id===source));
  let calls=0;
  const client={chat:{completions:{create:async req=>{
    assert.doesNotMatch(JSON.stringify(req.messages),/expectedAccept|expectedNotPass|expectedStances/);
    const {candidates,passages}=JSON.parse(req.messages[1].content);
    assert.equal(candidates.length,1);
    const e=fixtures.examples[calls++];
    assert.equal(candidates[0].fields.relationship,e.connection.relationship);
    for (const [i,word] of e.connection.words.entries())
      assert.equal(candidates[0].fields[`word_${i+1}`],`${word.term}: ${word.fit}`);
    if (e.connection.evidence.S112) {
      assert.deepEqual(passages.filter(p=>p.source==='S112').map(p=>p.text),
        catalog.filter(p=>p.source.id==='S112').map(p=>p.quote));
      assert.ok(passages.some(p=>p.source==='S112' && p.text.includes('partial_z(u0_z)=+A*H*C*phi')));
    }
    const fields=Object.fromEntries(Object.keys(candidates[0].fields).map(key=>[key,{
      stance:e.expectedStances?.[key]?.[0]||'asserted', proposition:candidates[0].fields[key],
      status:e.expectedNotPass?.includes(key)?'fail':'pass',reason:'Mock verdict for pipeline validation.'
    }]));
    const verdict={fields,checks:Object.fromEntries(CHECKS.map(x=>[x,'pass'])),reason:'Mock evaluation.',passages:Object.values(e.connection.evidence)};
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:verdict})}}]};
  }}}};
  const report=await checkComparisonExamples(client,'mock-model',undefined,'corpus');
  assert.equal(calls,14);
  assert.match(report,/14 of 14 expected decisions matched/);
  assert.match(report,/Synthetic examples/);
  assert.doesNotMatch(report,/## Pinned sources/);
});

test('corpus controls preserve the owner phrase and distinguish an unclaimed proof from a concealed one', () => {
  const examples=Object.fromEntries(fixtures.examples.map(e=>[e.case,e]));
  const language=examples['socio-didact-bounded'];
  assert.equal(language.connection.words[0].term,'preserves Sens while adjusting Sin');
  assert.equal(language.expectedAccept,true);
  const scaling=examples['alignment-stability-bounded'];
  assert.equal(scaling.connection.words[0].term,'product preserved under reciprocal scaling');
  const proof=examples['withheld-proof-bounded'];
  assert.equal(proof.connection.words[0].term,'evolution not proved here');
  assert.equal(proof.expectedAccept,true);
  assert.deepEqual(proof.expectedStances.word_1,['withheld','contrast']);
  assert.doesNotMatch(JSON.stringify([scaling.connection,proof.connection]),/bounded invariant|local mathematical result|withheld evolution proof/);
  const concealment=examples['withheld-proof-overclaim'];
  assert.match(concealment.connection.words[0].fit,/proof of global smoothness exists but is being concealed/);
  assert.equal(concealment.expectedAccept,false);
  assert.ok(concealment.expectedNotPass.includes('word_1'));
});

test('the corpus evaluation requires both the asserted initial proof and the withheld evolution stance', async () => {
  const positive=fixtures.examples.find(e=>e.case==='initial-proof-kept');
  const negative=fixtures.examples.find(e=>e.case==='initial-proof-denial-overclaim');
  assert.equal(positive.expectedAccept,true);
  assert.deepEqual(positive.expectedStances.word_1,['asserted']);
  assert.deepEqual(positive.expectedStances.word_2,['withheld','contrast']);
  assert.equal(negative.expectedAccept,false);
  assert.deepEqual(negative.expectedNotPass,['relationship','word_1']);
  assert.match(fixtures.sources.find(s=>s.id==='S112').provenance,
    /blob\/2d99c8c4fe36f4ca1e8b25339ab0358211bffbd3\/math\/notes\/smooth-initial-field\.tex/);

  // A keep verdict alone is insufficient if either substantive claim is misread.
  // These supplied verdicts exercise evaluation plumbing, not live model accuracy.
  for (const [wrongField,wrongStance] of [['word_1','withheld'],['word_2','asserted']]) {
    let calls=0;
    const client={chat:{completions:{create:async req=>{
      assert.doesNotMatch(JSON.stringify(req.messages),/expectedAccept|expectedNotPass|expectedStances/);
      const {candidates}=JSON.parse(req.messages[1].content);
      const e=fixtures.examples[calls++];
      const fields=Object.fromEntries(Object.keys(candidates[0].fields).map(key=>[key,{
        stance:e===positive && key===wrongField ? wrongStance : e.expectedStances?.[key]?.[0]||'asserted',
        proposition:candidates[0].fields[key], status:e.expectedNotPass?.includes(key)?'fail':'pass',
        reason:'Supplied verdict for stance-gating validation.'
      }]));
      const verdict={fields,checks:Object.fromEntries(CHECKS.map(x=>[x,'pass'])),reason:'Mock evaluation.',passages:Object.values(e.connection.evidence)};
      return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:verdict})}}]};
    }}}};
    const report=await checkComparisonExamples(client,'mock-model',undefined,'corpus');
    assert.equal(calls,14);
    assert.match(report,/13 of 14 expected decisions matched/);
    assert.match(report,/initial-proof-kept:[\s\S]*?Expected: keep\. Actual: keep\. \*\*FAIL\*\*/);
  }
});

test('corpus command is owner-only and does not collect the public repositories', async () => {
  const posted=[],updated=[];
  const octokit={paginate:async()=>[],issues:{listComments(){},createComment:async x=>{posted.push(x.body);return {data:{id:1}};},updateComment:async x=>updated.push(x.body)}};
  const config={owner:'example',controlRepository:'bot',repositories:['public'],filesPerBatch:2,charactersPerFile:600,maximumFileBytes:10000};
  let calls=0;
  const openai={chat:{completions:{create:async()=>{calls++;return {choices:[{finish_reason:'stop',message:{content:'{}'}}]};}}}};
  const h=createDiscoveryHandler({config,openai,model:'mock-model',log:{error(){}}});
  const context={octokit,issue:()=>({owner:'example',repo:'bot',issue_number:1}),payload:{sender:{login:'stranger',type:'User'},repository:{owner:{login:'example'},name:'bot'},issue:{number:1,title:'[Discover language] check corpus examples',user:{type:'User'}}}};
  await h.handle(context);assert.equal(posted.length,0);
  context.payload.sender.login='example';context.payload.repository.name='wrong';
  await h.handle(context);assert.equal(posted.length,0);
  context.payload.repository.name='bot';
  await h.handle(context);await h.waitForIdle();
  assert.equal(calls,14);assert.equal(updated.length,1);
  assert.match(updated[0],/synthetic corpus examples/);
});
