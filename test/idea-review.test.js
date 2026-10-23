const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewIdea } = require('../idea-review');
const text = 'Maybe this is just a guess. The integral establishes M(2)=1 in this model.';
function item() { return { quote:'Maybe this is just a guess.',status:'holds_up',claim:'M(2)=1 in the stated model.',support:'supported',explanation:'The supplied calculation supports the narrow result.',alternative:'The model calculation establishes M(2)=1.',confidence:{band:'none',basis:'The integral is supplied.',strengthen:'Empirical use needs separate data.',pullBack:'Keep the model assumptions.'} }; }
function client(items, finish_reason='stop') { return {chat:{completions:{create:async()=>({choices:[{finish_reason,message:{content:JSON.stringify({items})}}]})}}}; }
test('structured idea reviews distinguish supported results from problems and render the full tag', async()=>{
  const result=await reviewIdea(client([item()]),'gpt-5.4-mini','',text);
  assert.match(result,/What holds up/);assert.doesNotMatch(result,/Needs attention/);
  assert.match(result,/Confidence: High/);assert.match(result,/To strengthen/);assert.match(result,/To narrow/);
});
test('missing bands, invented quotations and incomplete responses never publish',async()=>{
  const bad=item();bad.support='partial';
  await assert.rejects(reviewIdea(client([bad]),'gpt-5.4-mini','',text));
  bad.confidence.band='upper';bad.quote='An invented quotation';
  await assert.rejects(reviewIdea(client([bad]),'gpt-5.4-mini','',text));
  await assert.rejects(reviewIdea(client([item()],'length'),'gpt-5.4-mini','',text));
});

test('a certain counterexample gives the original contradicted idea Low support', async()=>{
  const original='Equal products imply identical states.';
  const bad=item();Object.assign(bad,{quote:original,claim:original,status:'needs_attention',support:'contradicted'});
  bad.confidence.level='high'; // Even a stray model rating cannot override support.
  bad.confidence.basis='Distinct factor pairs have the same product.';
  const result=await reviewIdea(client([bad]),'gpt-5.4-mini','',original);
  assert.match(result,/Idea assessed:\*\* Equal products imply identical states/);
  assert.match(result,/Confidence: Low/);assert.doesNotMatch(result,/Confidence: High/);
  for(const band of ['lower','middle','upper']){
    const partly=item();partly.support='partial';partly.confidence.band=band;
    assert.match(await reviewIdea(client([partly]),'gpt-5.4-mini','',text),new RegExp(`Confidence: Medium \\(${band}\\)`));
  }
});

test('one repair attempt can recover an exact quotation without publishing the invalid draft', async()=>{
  let calls=0;
  const bad=item();bad.quote='Invented private draft';
  const api={chat:{completions:{create:async request=>{
    calls++;
    if(calls===2){
      assert.match(request.messages.at(-2).content,/exact contiguous phrase/);
      assert.equal(request.messages.at(-1).content,text);
      assert.ok(!JSON.stringify(request.messages).includes(bad.quote));
    }
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[calls===1?bad:item()]})}}]};
  }}}};
  const result=await reviewIdea(api,'gpt-5.4-mini','',text);
  assert.equal(calls,2);assert.match(result,/Confidence: High/);assert.ok(!result.includes(bad.quote));
});

test('repeated validation failures stop after two calls with a safe diagnostic', async()=>{
  let calls=0;const bad=item();bad.confidence.basis='private response marker'.repeat(100);
  const api=client([bad]);const create=api.chat.completions.create;
  api.chat.completions.create=async()=>{calls++;return create();};
  await assert.rejects(reviewIdea(api,'gpt-5.4-mini','',text),error=>{
    assert.equal(error.code,'idea_confidence');assert.equal(error.type,'idea_validation');
    assert.doesNotMatch(error.message,/private response marker/);return true;
  });
  assert.equal(calls,2);
});

test('refusals and provider failures do not trigger validation retries', async()=>{
  for(const refusal of [true,false]){
    let calls=0;
    const api={chat:{completions:{create:async()=>{
      calls++;
      if(refusal)return {choices:[{finish_reason:'stop',message:{refusal:'declined'}}]};
      throw Object.assign(new Error('provider failure'),{status:401,code:'invalid_api_key'});
    }}}};
    await assert.rejects(reviewIdea(api,'gpt-5.4-mini','',text),error=>error.code===(refusal?'idea_refusal':'invalid_api_key'));
    assert.equal(calls,1);
  }
});

test('the response schema restricts quotations to unchanged Unicode source spans', async()=>{
  const original='The Socio-Didact preserves Sens while adjusting Sin.\n\nA′=ΔU; M′=J; div(u0)=−AHCφ+AHCφ=0.\n'+'x'.repeat(1599)+'😀'+'y'.repeat(2000);
  let checked=false;
  const api={chat:{completions:{create:async request=>{
    const choices=request.response_format.json_schema.schema.properties.items.items.properties.quote.enum;
    assert.ok(choices.includes('The Socio-Didact preserves Sens while adjusting Sin.'));
    assert.ok(choices.includes('A′=ΔU; M′=J; div(u0)=−AHCφ+AHCφ=0.'));
    for(const quote of choices){assert.ok(original.includes(quote));assert.ok(quote.length<=1600);assert.ok(quote.isWellFormed());}
    assert.equal(request.messages.at(-1).content,original);
    checked=true;const result=item();result.quote=choices[0];
    return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[result]})}}]};
  }}}};
  assert.match(await reviewIdea(api,'gpt-5.4-mini','',original),/preserves Sens while adjusting Sin/);
  assert.equal(checked,true);
});
