const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parseSourceRequest, collectPinnedSources, validateProposals } = require('../pinned-sources');
const { CHECKS } = require('../comparison-audit');
const { eligible, citationPassages, generateDiscovery, createDiscoveryHandler } = require('../discovery');
const { validConfidence } = require('../confidence');
const config = { owner:'example',controlRepository:'bot',repositories:['research'],filesPerBatch:2,charactersPerFile:6000,maximumFileBytes:100000 };
const commit = 'a'.repeat(40);
const urls = ['one.md','two.md'].map(p => `https://github.com/example/bot/blob/${commit}/${p}`);
const sourceText = ['A local definition assigns a meaning to the author’s unusual phrase.', 'The author uses that same defined phrase without changing its meaning.'];
const proposal = (title='Bounded proposal') => ({ title,kind:'interpretive',relationship:'Both passages concern a local meaning.',limit:'No measured reader response is claimed.',words:[{term:'local meaning',kind:'candidate',fit:'A usage scoped to this author.'}],evidence:{S1:'S1P1',S2:'S2P1'} });
function github(privateRepo=false) {
  const reads=[];
  return {reads,repos:{get:async()=>({data:{private:privateRepo,visibility:privateRepo?'private':'public'}}),getContent:async args=>{
    reads.push(args);const text=sourceText[args.path==='one.md'?0:1];
    return {data:{type:'file',encoding:'base64',size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64')}};
  }}};
}
const response = (x,id) => ({id,model:'mock',choices:[{finish_reason:'stop',message:{content:JSON.stringify(x)}}]});
function api({failure,generated=[proposal('Generated safe')]}={}) {
  const requests=[];
  return {requests,chat:{completions:{create:async request=>{
    requests.push(request);
    if(request.response_format.json_schema.name==='language_discovery')return response({connections:generated},'generation-id');
    const c=JSON.parse(request.messages[1].content).candidates[0];
    const checks=Object.fromEntries(CHECKS.map(x=>[x,'pass']));
    if(failure && c.fields.title==='Supplied blocked') {
      if(failure.status===undefined)delete checks[failure.key];else checks[failure.key]=failure.status;
    }
    return response({C1:{fields:Object.fromEntries(Object.keys(c.fields).map(k=>[k,{stance:'asserted',proposition:'Bounded proposition.',status:'pass',reason:'Mock field decision.'}])),checks,passages:['S1P1','S2P1'],reason:'Mock comparison decision.'}},'review-'+requests.length);
  }}}};
}
function receipt(report) { return JSON.parse(Buffer.from(/<!-- publication-receipt:([^ ]+) -->/.exec(report)[1],'base64').toString()); }

test('pinned sources require allowed public immutable files and preserve all text',async()=>{
  const request=parseSourceRequest(JSON.stringify({sources:urls}),config,eligible),gh=github();
  const collected=await collectPinnedSources(gh,request,config);
  assert.deepEqual(collected.sources.map(s=>s.excerpts[0].text),sourceText);
  assert.ok(gh.reads.every(r=>r.ref===commit));
  const privateApi=github(true);
  await assert.rejects(collectPinnedSources(privateApi,request,config),{code:'private_source'});
  assert.equal(privateApi.reads.length,0);
  for(const url of [urls[0].replace(commit,'main'),urls[0].replace('/example/','/other/'),urls[0].replace('one.md','secrets/key.txt'),urls[0]+'?token=hidden','https://example.org/x'])
    assert.throws(()=>parseSourceRequest(JSON.stringify({sources:[url,urls[1]]}),config,eligible));
  assert.throws(()=>parseSourceRequest(JSON.stringify({sources:[urls[0],urls[0]]}),config,eligible));
});

test('duplicate content and oversize sources stop before analysis instead of silent truncation',async()=>{
  const req=parseSourceRequest(JSON.stringify({sources:urls}),config,eligible);
  const gh=github();gh.repos.getContent=async()=>({data:{type:'file',encoding:'base64',size:10,content:Buffer.from('Identical source in two files.').toString('base64')}});
  await assert.rejects(collectPinnedSources(gh,req,config));
  await assert.rejects(collectPinnedSources(github(),req,{...config,charactersPerFile:5}));
});

test('supplied proposals reject grading keys, unknown passages and single-source evidence',async()=>{
  const collected=await collectPinnedSources(github(),parseSourceRequest(JSON.stringify({sources:urls}),config,eligible),config);
  const catalog=citationPassages(collected.sources);
  validateProposals([proposal()],catalog,validConfidence);
  for(const p of [{...proposal(),expectedAccept:true},{...proposal(),evidence:{S1:'S1P1'}},{...proposal(),evidence:{S1:'S1P1',S2:'S1P1'}}])
    assert.throws(()=>validateProposals([p],catalog,validConfidence));
});

test('new required checks mechanically withhold drafts before the real renderer, including missing judgments',async()=>{
  const collected=await collectPinnedSources(github(),parseSourceRequest(JSON.stringify({sources:urls}),config,eligible),config);
  for(const key of ['definition_fidelity','count_scope'])for(const status of ['fail','uncertain',undefined]){
    const client=api({failure:{key,status}}),bad=proposal('Supplied blocked');
    const report=await generateDiscovery(client,'mock','',collected,null,[],{proposals:[bad]});
    const visible=report.split('<!-- publication-receipt:')[0];
    assert.match(visible,/## Generated safe/);assert.doesNotMatch(visible,/## Supplied blocked/);
    const r=receipt(report);assert.equal(r.decisions.length,2);assert.equal(r.decisions[1].accepted,false);assert.ok(r.decisions[1].failed.includes(key));
    assert.equal(r.decisions[1].sha256,createHash('sha256').update(JSON.stringify(bad)).digest('hex'));
    assert.equal(r.generation.responseId,'generation-id');assert.ok(r.decisions.every(d=>d.responseId));
    // Proposals and expected decisions must not steer source generation.
    assert.ok(!JSON.stringify(client.requests[0].messages).includes('Supplied blocked'));
  }
});

test('supported controls pass rather than blocking everything; incomplete review publishes no report',async()=>{
  const collected=await collectPinnedSources(github(),parseSourceRequest(JSON.stringify({sources:urls}),config,eligible),config);
  const report=await generateDiscovery(api(),'mock','',collected,null,[],{proposals:[proposal('Supplied supported')]});
  assert.match(report,/## Supplied supported/);assert.ok(receipt(report).decisions.every(d=>d.accepted));
  const broken=api();const create=broken.chat.completions.create;
  broken.chat.completions.create=async req=>req.response_format.json_schema.name==='language_discovery'?create(req):{choices:[{finish_reason:'length',message:{content:'partial'}}]};
  await assert.rejects(generateDiscovery(broken,'mock','',collected,null,[],{proposals:[proposal()]}),{code:'incomplete_audit'});
});

test('a passing review cannot cause a truncated claim to be published',async()=>{
  const collected=await collectPinnedSources(github(),parseSourceRequest(JSON.stringify({sources:urls}),config,eligible),config);
  const overlong={...proposal('Too long to publish'),relationship:'A'.repeat(1501)};
  const report=await generateDiscovery(api({generated:[overlong]}),'mock','',collected);
  assert.doesNotMatch(report,/## Too long to publish/);
  assert.equal(receipt(report).decisions[0].accepted,false);
  assert.ok(receipt(report).decisions[0].failed.includes('publication_format'));
});

test('actual issue handler collects, generates, gates, and posts once; unauthorized and redelivered requests do not run',async()=>{
  const gh=github(),comments=[],updates=[],client=api({failure:{key:'definition_fidelity',status:'fail'}});
  gh.paginate=async()=>comments;
  gh.issues={listComments:()=>{},createComment:async p=>{comments.push({user:{type:'Bot'},body:p.body});return {data:{id:99}};},updateComment:async p=>{updates.push(p);comments[0].body=p.body;}};
  const handler=createDiscoveryHandler({config,openai:client,model:'mock',skills:'',log:{info(){},error(){}}});
  const body=JSON.stringify({sources:urls,proposals:[proposal('Supplied blocked')]});
  const context={id:'delivery-test',payload:{sender:{type:'User',login:'example'},repository:{name:'bot',full_name:'example/bot',owner:{login:'example'}},issue:{number:9,title:'[Discover language] sources',body,user:{type:'User'}}},octokit:gh,issue:()=>({owner:'example',repo:'bot',issue_number:9})};
  await handler.handle({...context,payload:{...context.payload,sender:{type:'User',login:'other'}}});assert.equal(client.requests.length,0);
  await handler.handle(context);await handler.waitForIdle();
  assert.equal(updates.length,1);assert.doesNotMatch(updates[0].body,/## Supplied blocked/);assert.match(updates[0].body,/## Generated safe/);
  assert.equal(receipt(updates[0].body).deliveryId,'delivery-test');assert.equal(receipt(updates[0].body).inputSha256,createHash('sha256').update(body).digest('hex'));
  const calls=client.requests.length;await handler.handle(context);await handler.waitForIdle();assert.equal(client.requests.length,calls);assert.equal(updates.length,1);
});
