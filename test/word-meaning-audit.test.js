const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluateWords,auditWordMeanings}=require('../word-meaning-audit');
const {publishDiscoveryDraft}=require('../discovery');
const {CHECKS,reviewFields}=require('../comparison-audit');
const word={term:'untested wording',kind:'candidate',fit:'A candidate gloss.'};
const row={sourceMeaning:'Considers options.',proposedMeaning:'Chooses an option.',contrastCase:'Considering and declining to choose.',effect:'different',changeDisclosed:false,status:'pass',reason:'A semantic difference.'};

test('an undisclosed shift blocks even a contradictory pass; missing analyses never pass',()=>{
  assert.equal(evaluateWords([word],{word_1:row}).accepted,false);
  for(const key of Object.keys(row)) {const copy={...row};delete copy[key];assert.equal(evaluateWords([word],{word_1:copy}).accepted,false,key);}
  assert.equal(evaluateWords([word],{word_1:{...row,changeDisclosed:true}}).accepted,true);
  assert.equal(evaluateWords([word],{word_1:{...row,effect:'same_in_context'}}).accepted,true);
});
test('the focused reviewer gets full context, no earlier verdict or grading key, and logs no draft',async()=>{
  const candidate={title:'private-marker',words:[word],evidence:{S1:'S1P1',S2:'S2P1'}};
  const catalog=[{id:'S1P1',source:{id:'S1'},quote:'Definition.'},{id:'S1P2',source:{id:'S1'},quote:'Adjacent qualification.'},{id:'S2P1',source:{id:'S2'},quote:'Second source.'},{id:'S3P1',source:{id:'S3'},quote:'Unrelated.'}];
  const logs=[];
  const client={chat:{completions:{create:async req=>{
    assert.equal(req.response_format.json_schema.name,'word_meaning_audit');
    const data=JSON.parse(req.messages[1].content);
    assert.deepEqual(data.candidate,candidate);assert.equal(data.passages.length,3);
    assert.doesNotMatch(JSON.stringify(req.messages),/expectedAccept|earlierVerdict/);
    return {id:'word-real-id',choices:[{finish_reason:'stop',message:{content:JSON.stringify({word_1:row})}}]};
  }}}};
  const d=await auditWordMeanings(client,'gpt-5.4',candidate,catalog,{info:(...x)=>logs.push(x)});
  assert.equal(d.accepted,false);assert.equal(d.responseId,'word-real-id');assert.deepEqual(d.rawReview.word_1,row);
  assert.doesNotMatch(JSON.stringify(logs),/private-marker|Considers options/);
});
test('a broad pass followed by a lexical failure is withheld before rendering; supported control publishes',async()=>{
  const candidate={title:'Candidate to gate',kind:'interpretive',relationship:'The notes share an invitation.',limit:'No observed response claimed.',words:[word],evidence:{S1:'S1P1',S2:'S2P1'}};
  const collected={sources:['First source defines an invitation to consider.','Second source repeats that invitation to consider.'].map((text,i)=>({id:`S${i+1}`,repository:'example/research',path:`${i}.md`,url:`https://example.org/${i}`,excerpts:[{startLine:1,text}]}))};
  for(const status of ['fail','uncertain','pass']){
    const client={chat:{completions:{create:async req=>{
      if(req.response_format.json_schema.name==='word_meaning_audit')return {id:'words',choices:[{finish_reason:'stop',message:{content:JSON.stringify({word_1:{...row,effect:'same_in_context',status}})}}]};
      return {id:'broad',choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:{fields:Object.fromEntries(Object.keys(reviewFields(candidate)).map(k=>[k,{stance:'asserted',proposition:'Bounded.',status:'pass',reason:'Mock broad verdict.'}])),checks:Object.fromEntries(CHECKS.map(k=>[k,'pass'])),passages:['S1P1','S2P1'],reason:'Mock broad pass.'}})}}]};
    }}}};
    const report=await publishDiscoveryDraft(client,'mock',[candidate],collected);
    assert.equal(report.includes('## Candidate to gate'),status==='pass');
    const receipt=JSON.parse(Buffer.from(/publication-receipt:([^ ]+)/.exec(report)[1],'base64'));
    assert.equal(receipt.decisions[0].accepted,status==='pass');
    assert.equal(receipt.decisions[0].wordAudit.responseId,'words');
  }
});
test('incomplete or refused focused reviews abort publication rather than falling back',async()=>{
  for(const choice of [{finish_reason:'length',message:{content:'{}'}},{finish_reason:'stop',message:{refusal:'No',content:null}}]){
    const client={chat:{completions:{create:async()=>({choices:[choice]})}}};
    await assert.rejects(auditWordMeanings(client,'mock',{words:[word],evidence:{S1:'S1P1'}},[{id:'S1P1',source:{id:'S1'},quote:'Source.'}]),{code:'incomplete_word_audit'});
  }
});
