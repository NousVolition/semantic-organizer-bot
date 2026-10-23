const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewIdea } = require('../idea-review');
const text = 'Maybe this is just a guess. The integral establishes M(2)=1 in this model.';
function item() { return { quote:'Maybe this is just a guess.',status:'holds_up',explanation:'The supplied calculation supports the narrow result.',alternative:'The model calculation establishes M(2)=1.',confidence:{level:'high',band:'none',basis:'The integral is supplied.',strengthen:'Empirical use needs separate data.',pullBack:'Keep the model assumptions.'} }; }
function client(items, finish_reason='stop') { return {chat:{completions:{create:async()=>({choices:[{finish_reason,message:{content:JSON.stringify({items})}}]})}}}; }
test('structured idea reviews distinguish supported results from problems and render the full tag', async()=>{
  const result=await reviewIdea(client([item()]),'gpt-5.4-mini','',text);
  assert.match(result,/What holds up/);assert.doesNotMatch(result,/Needs attention/);
  assert.match(result,/Confidence: High/);assert.match(result,/To strengthen/);assert.match(result,/To narrow/);
});
test('missing bands, invented quotations and incomplete responses never publish',async()=>{
  const bad=item();bad.confidence.level='medium';
  await assert.rejects(reviewIdea(client([bad]),'gpt-5.4-mini','',text));
  bad.confidence.band='upper';bad.quote='An invented quotation';
  await assert.rejects(reviewIdea(client([bad]),'gpt-5.4-mini','',text));
  await assert.rejects(reviewIdea(client([item()],'length'),'gpt-5.4-mini','',text));
});
