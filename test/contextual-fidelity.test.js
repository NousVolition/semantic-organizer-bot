const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fidelityFields,fidelitySchema,evaluateFidelity}=require('../contextual-fidelity');
const {publishDiscoveryDraft,safeText,citationPassages}=require('../discovery');
const {CHECKS,reviewFields}=require('../comparison-audit');
const c={title:'Withheld proof',kind:'interpretive',relationship:'The algebra proves an identity. A proof of stability is not claimed.',
  limit:'Stability can still be conjectured.',words:[{term:'withheld proof',kind:'candidate',fit:'Names the proof claim not made; no concealed proof is asserted.'}],
  confidence:{level:'high',band:'none',basis:'The identity is derived; a stability proof is not claimed.',strengthen:'An evolution argument could establish stability.',pullBack:'Keep the proof confined to the identity.'},evidence:{S1:'S1P1',S2:'S2P1'}};
const collected={sources:['For nonzero t, (tx)(y/t)=xy.','No proof of dynamic stability is claimed.'].map((text,i)=>({id:`S${i+1}`,repository:'example/research',path:`${i}.md`,url:`https://example.org/${i}`,excerpts:[{startLine:1,text}]}))};
const catalog=citationPassages(collected.sources);
function grounded(){return Object.fromEntries(Object.entries(fidelityFields(c)).map(([k,value])=>[k,{
  candidateText:value,reading:'Transport mock preserving the actual object.',withheldObject:'A proof of dynamic stability.',
  sourceBindings:[{passage:'S2P1',quote:catalog[1].quote,referent:'The second note.'}],
  contextAnchors:[{field:'relationship',quote:'A proof of stability is not claimed.'}],support:'supported',status:'pass',reason:'Transport mock.'
}]));}

test('contextual review binds every field and each confidence explanation to exact text',()=>{
  const schema=fidelitySchema(c,catalog),fields=fidelityFields(c);
  assert.deepEqual(schema.required,Object.keys(fields));
  for(const key of Object.keys(fields))assert.deepEqual(schema.properties[key].properties.candidateText.enum,[fields[key]]);
  const review=grounded();assert.equal(evaluateFidelity(c,review,catalog).accepted,true);
  for(const key of Object.keys(fields)){
    const incomplete=structuredClone(review);delete incomplete[key];
    assert.equal(evaluateFidelity(c,incomplete,catalog).accepted,false,key);
  }
});

test('repaired candidate text, fabricated evidence, false context, and contradictory support cannot pass',()=>{
  for(const mutate of [
    r=>r.candidateText='A safer paraphrase.',
    r=>r.sourceBindings[0].quote='A nonexistent source statement.',
    r=>r.sourceBindings[0].passage='S3P1',
    r=>r.sourceBindings=[],
    r=>r.contextAnchors[0].quote='Proof exists but is concealed.',
    r=>r.support='unsupported',
    r=>r.support='uncertain',
    r=>delete r.withheldObject
  ]){const review=grounded();mutate(review.confidence_basis);assert.equal(evaluateFidelity(c,review,catalog).accepted,false);}
});

test('contextual confidence failure blocks actual publication even when broad and word checks pass',async()=>{
  for(const support of ['supported','unsupported','uncertain']){
    const client={chat:{completions:{create:async req=>{
      if(req.response_format.json_schema.name==='word_meaning_audit'){
        const mock=require('./helpers/word-response')(req),review=JSON.parse(mock.choices[0].message.content);
        review.claimFields=grounded();review.claimFields.confidence_basis.support=support;
        mock.choices[0].message.content=JSON.stringify(review);return mock;
      }
      return {id:'broad-mock',choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:{
        fields:Object.fromEntries(Object.keys(reviewFields(c)).map(k=>[k,{stance:'mixed',proposition:'Mock.',status:'pass',reason:'Mock.'}])),
        checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),passages:['S1P1','S2P1'],reason:'Mock.'
      }})}}]};
    }}}};
    const report=await publishDiscoveryDraft(client,'mock',[c],collected);
    assert.equal(report.includes('## Withheld proof'),support==='supported');
    const receipt=JSON.parse(Buffer.from(/publication-receipt:([^ ]+)/.exec(report)[1],'base64'));
    assert.equal(receipt.decisions[0].checks.contextual_fidelity,support==='supported'?'pass':'fail');
    assert.equal(receipt.decisions[0].wordAudit.claimStatuses.confidence_basis,support==='supported'?'pass':support==='unsupported'?'fail':'uncertain');
  }
});

test('publication strips ANSI and controls without erasing unusual words, mathematics or line breaks',()=>{
  const raw='\u001b[0mpreserves Sens while adjusting Sin\u001b[31m\nλ ≠ 0; (λx)(y/λ) = xy\u001b[0m\u0000\u0007';
  const clean=safeText(raw);
  assert.doesNotMatch(clean,/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/);
  assert.doesNotMatch(clean,/\[0m|\[31m/);assert.match(clean,/preserves Sens while adjusting Sin\nλ ≠ 0/);
  assert.equal(safeText('\u001b[31mABC\u001b[0m',3),'ABC');
  assert.equal(safeText('\u001b]8;;https://example.org\u0007label\u001b]8;;\u0007'),'label');
});
