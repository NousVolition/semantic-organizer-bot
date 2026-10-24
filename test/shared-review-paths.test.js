const {test}=require('node:test');
const assert=require('node:assert/strict');
const {auditSemanticCandidates,auditPublicationCandidates}=require('../publication-audit');
const {CHECKS,reviewFields}=require('../comparison-audit');
const {citationPassages}=require('../discovery');
const candidate={title:'A bounded claim',kind:'interpretive',relationship:'The note offers a claim.',limit:'No further result is established.',words:[{term:'candidate',kind:'candidate',fit:'A provisional description.'}],evidence:{S1:'S1P1'}};
const catalog=citationPassages([{id:'S1',url:'https://example.org/source',excerpts:[{startLine:1,text:'A provisional claim is offered in this note.'}]}]);
test('single-source semantic exercises cannot pass a broad pass plus contextual failure',async()=>{
  const stages=[];
  const client={chat:{completions:{create:async request=>{
    const stage=request.response_format.json_schema.name;stages.push(stage);
    if(stage==='word_meaning_audit'){
      const response=require('./helpers/word-response')(request);
      const raw=JSON.parse(response.choices[0].message.content);
      raw.claimFields.relationship.support='unsupported';
      raw.claimFields.relationship.status='fail';
      raw.claimFields.relationship.reason='Injected contextual failure tests actual gating.';
      response.choices[0].message.content=JSON.stringify(raw);return response;
    }
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:{fields:Object.fromEntries(Object.keys(reviewFields(candidate)).map(k=>[k,{stance:'asserted',proposition:'Mock.',status:'pass',reason:'Mock.'}])),checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),passages:['S1P1'],reason:'Mock broad pass.'}})}}]};
  }}}};
  const [semantic]=await auditSemanticCandidates(client,'mock',[candidate],catalog);
  assert.deepEqual(stages,['comparison_audit','word_meaning_audit']);
  assert.equal(semantic.accepted,false);assert.equal(semantic.checks.contextual_fidelity,'fail');
  const [publication]=await auditPublicationCandidates(client,'mock',[candidate],catalog);
  assert.equal(publication.accepted,false);assert.ok(publication.failed.includes('publication_evidence'));
});
