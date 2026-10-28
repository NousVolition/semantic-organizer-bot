const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createGitHubStateStore, codec, acquireLease, createCheckpoint, BRANCH} = require('../discovery-state');

const config = {owner:'example',controlRepository:'bot',repositories:['alpha','beta'],
  readingMode:'complete',filesPerBatch:2,charactersPerFile:600,maximumFileBytes:10000};
const secret = 'test-only-state-key-never-used-live';
const missing = () => Object.assign(new Error('missing'),{status:404});
function fixture(count = 2) {
  let seq = 0, failBlob, failUpdate = false, privateRepo;
  const files = new Map(), comments = [], calls = {trees:0,blobs:[],writes:0,commits:0};
  const api = {
    repos: {
      get: async ({repo}) => ({data:{name:repo,full_name:`example/${repo}`,owner:{login:'example'},private:repo === privateRepo,default_branch:'main'}}),
      getCommit: async ({repo,ref}) => ({data:{sha:(repo === 'alpha' ? 'a' : 'b').repeat(40),commit:{tree:{sha:repo}}}}),
      getContent: async p => {
        assert.equal(p.repo,'bot'); assert.equal(p.ref,BRANCH);
        const file = files.get(p.path); if (!file) throw missing();
        return {data:{type:'file',encoding:'base64',size:Buffer.from(file.content,'base64').length,...file}};
      },
      createOrUpdateFileContents: async p => {
        assert.equal(p.repo,'bot'); assert.equal(p.branch,BRANCH);
        const file = files.get(p.path);
        if ((file?.sha || undefined) !== p.sha) throw Object.assign(new Error('conflict'),{status:409});
        const sha = String(++seq); files.set(p.path,{sha,content:p.content}); calls.writes++;
        return {data:{content:{sha}}};
      }
    },
    git: {
      getRef: async () => ({data:{object:{sha:'existing-state-branch'}}}),
      getTree: async ({repo}) => { calls.trees++; return {data:{tree:Array.from({length:Math.ceil(count/2)},(_,i)=>({
        path:`${i}.md`,mode:'100644',type:'blob',size:200,sha:`${repo}-${i}`}))}}; },
      getBlob: async ({file_sha}) => {
        calls.blobs.push(file_sha);
        if (file_sha === failBlob) throw new Error('simulated interruption');
        return {data:{encoding:'base64',content:Buffer.from(`Document ${file_sha} describes a precise shared observation and its distinct context.\n`.repeat(2)).toString('base64')}};
      }
    },
    issues: {
      get: async ({issue_number}) => ({data:{...context(issue_number).payload.issue,state:'open'}}),
      listComments() {},
      createComment: async p => { const c = {id:++seq,user:{type:'Bot'},body:p.body,issue:p.issue_number}; comments.push(c); return {data:c}; },
      updateComment: async p => { if (failUpdate) throw new Error('publication disconnected'); const c = comments.find(c=>c.id===p.comment_id); c.body=p.body; return {data:c}; }
    },
    paginate: async (_,p) => comments.filter(c=>c.issue===p.issue_number)
  };
  const context = (number=1,title='[Discover language]') => ({octokit:api,issue:()=>({owner:'example',repo:'bot',issue_number:number}),
    payload:{sender:{login:'example',type:'User'},repository:{name:'bot',full_name:'example/bot',owner:{login:'example'}},
      issue:{number,title,body:'',user:{type:'User'}}}});
  return {api,calls,files,comments,context,failBlob:sha=>{failBlob=sha;},failUpdate:v=>{failUpdate=v;},privateRepo:r=>{privateRepo=r;},
    store:()=>createGitHubStateStore(api,config,secret)};
}

function coldDiscovery() {
  delete require.cache[require.resolve('../complete-reading')];
  delete require.cache[require.resolve('../discovery')];
  return require('../discovery');
}
const log = {error(){},warn(){}};
function handler(f, openai, extras={}) {
  return coldDiscovery().createDiscoveryHandler({config,openai,model:'test',skills:'test rules',log,stateStoreForContext:f.store,...extras});
}
async function run(h,c) { await h.handle(c); await h.waitForIdle(); }

test('encrypted GitHub state round-trips across fresh stores, fails on tampering, and uses compare-and-swap',async()=>{
  const f=fixture(), a=f.store(), b=f.store();
  await a.set('job',{source:'unreviewed secret passage',steps:{generation:[1,2]}});
  assert.ok(!JSON.stringify([...f.files.values()]).includes('unreviewed secret passage'));
  assert.deepEqual(await b.get('job'),{source:'unreviewed secret passage',steps:{generation:[1,2]}});
  await a.set('job',{version:2});
  await assert.rejects(b.set('job',{version:3}),{code:'checkpoint_conflict'});
  const crypt=codec(secret,'scope'), encoded=crypt.encode({s:'text'},'path');
  assert.throws(()=>crypt.decode(encoded,'other-path'),{code:'checkpoint_unreadable'});
  assert.throws(()=>codec('a-different-test-secret','scope').decode(encoded,'path'),{code:'checkpoint_unreadable'});
  const value=JSON.parse(Buffer.from(encoded,'base64')); value.data='AAAA';
  assert.throws(()=>crypt.decode(Buffer.from(JSON.stringify(value)).toString('base64'),'path'),{code:'checkpoint_unreadable'});
});

test('startup worker resumes a crashed job after lease expiry without a reopened event and fences the old worker',async()=>{
  const {createRecoveryWorker,PENDING}=require('../discovery-recovery');
  const f=fixture(),m=modelFixture();m.recover();
  let reached,release,focused=0;
  const blocked=new Promise(resolve=>{reached=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const create=m.openai.chat.completions.create;
  m.openai.chat.completions.create=async request=>{
    if(request.response_format.json_schema.name==='word_meaning_audit' && ++focused===2) {reached();await gate;}
    return create(request);
  };
  const old=handler(f,m.openai);await old.handle(f.context());await blocked;
  const store=f.store(),fresh=handler(f,m.openai);
  const worker=createRecoveryWorker({getClient:async()=>({store,octokit:f.api}),config,handler:fresh,log});
  await worker.tick();
  assert.equal(m.calls.focused,1,'live lease prevents a second worker');
  await store.update('discovery/lease',value=>({...value,expires:0}));
  const reads=f.calls.blobs.length;
  await worker.tick();
  assert.deepEqual(m.calls,{generation:1,broad:2,focused:2});
  assert.equal(f.calls.blobs.length,reads);
  assert.equal(f.comments.length,1);assert.match(f.comments[0].body,/discovery-complete:v1/);
  assert.deepEqual((await store.get(PENDING)).jobs,{});
  const report=f.comments[0].body;release();await old.waitForIdle();
  assert.equal(f.comments[0].body,report,'late old response must not overwrite the resumed report');
  await worker.tick();assert.equal(m.calls.generation,1);
});

test('startup registry can recover the crash gap before the first job checkpoint',async()=>{
  const {createRecoveryWorker,rememberJob,PENDING}=require('../discovery-recovery');
  const f=fixture(),m=modelFixture();m.recover();const store=f.store();
  await rememberJob(store,f.context().payload.issue);
  await createRecoveryWorker({getClient:async()=>({store,octokit:f.api}),config,handler:handler(f,m.openai),log}).tick();
  assert.equal(m.calls.generation,1);assert.match(f.comments[0].body,/discovery-complete:v1/);
  assert.deepEqual((await store.get(PENDING)).jobs,{});
});

test('automatic recovery does not restart paused jobs, closed issues or edited requests',async()=>{
  const {createRecoveryWorker,rememberJob,PENDING,jobKey}=require('../discovery-recovery');
  for(const scenario of ['paused','closed','edited']) {
    const f=fixture(),m=modelFixture(),store=f.store();
    await rememberJob(store,f.context().payload.issue);
    if(scenario==='paused')await store.set(jobKey(config,1),{status:'paused'});
    f.api.issues.get=async()=>({data:{...f.context().payload.issue,state:scenario==='closed'?'closed':'open',body:scenario==='edited'?'Changed request':''}});
    const worker=createRecoveryWorker({getClient:async()=>({store,octokit:f.api}),config,handler:handler(f,m.openai),log});
    await worker.tick();await worker.tick();
    assert.equal(m.calls.generation,0,scenario);
    assert.equal(f.comments.length,scenario==='edited'?1:0,'blocked jobs must not spam comments');
    const pending=(await store.get(PENDING)).jobs;
    if(scenario==='paused')assert.deepEqual(pending,{});
    else assert.ok(pending[1].blocked);
  }
});

test('ordinary provider failure pauses the job without an automatic paid retry loop',async()=>{
  const {createRecoveryWorker,PENDING}=require('../discovery-recovery');
  const f=fixture(),m=modelFixture(),store=f.store();
  await run(handler(f,m.openai),f.context());const calls={...m.calls};
  await createRecoveryWorker({getClient:async()=>({store,octokit:f.api}),config,handler:handler(f,m.openai),log}).tick();
  assert.deepEqual(m.calls,calls);assert.deepEqual((await store.get(PENDING)).jobs,{});
});

test('automatic recovery retries a disconnected final publication without another model call',async()=>{
  const {createRecoveryWorker,PENDING}=require('../discovery-recovery');
  const f=fixture(),m=modelFixture();m.recover();f.failUpdate(true);
  await run(handler(f,m.openai),f.context());const calls={...m.calls};f.failUpdate(false);
  const store=f.store();
  await createRecoveryWorker({getClient:async()=>({store,octokit:f.api}),config,handler:handler(f,m.openai),log}).tick();
  assert.deepEqual(m.calls,calls);assert.equal(f.comments.length,1);assert.match(f.comments[0].body,/discovery-complete:v1/);
  assert.deepEqual((await store.get(PENDING)).jobs,{});
});

test('recovery scheduler backs off failed storage checks, prevents overlap and stops cleanly',async()=>{
  const {createRecoveryWorker}=require('../discovery-recovery');
  const timers=[];let calls=0,cleared;
  const worker=createRecoveryWorker({config,handler:{},log,getClient:async()=>{calls++;throw new Error('offline');},
    schedule:(callback,delay)=>{const token={callback,delay,unref(){}};timers.push(token);return token;},cancel:token=>{cleared=token;}});
  worker.start();worker.start();assert.equal(timers.length,1);assert.equal(timers[0].delay,5000);
  await timers[0].callback();assert.equal(timers[1].delay,60000);
  await timers[1].callback();assert.equal(timers[2].delay,120000);
  worker.stop();assert.equal(cleared,timers[2]);assert.equal(calls,2);
});

test('a removed issue cannot starve other pending jobs and an overlapping tick cannot run twice',async()=>{
  const {createRecoveryWorker,rememberJob,PENDING}=require('../discovery-recovery');
  const f=fixture(),m=modelFixture();m.recover();const store=f.store();
  await rememberJob(store,f.context(1).payload.issue);await rememberJob(store,f.context(2).payload.issue);
  f.api.issues.get=async ({issue_number})=>{if(issue_number===1)throw missing();return {data:{...f.context(2).payload.issue,state:'open'}};};
  const worker=createRecoveryWorker({getClient:async()=>({store,octokit:f.api}),config,handler:handler(f,m.openai),log});
  await Promise.all([worker.tick(),worker.tick()]);
  assert.equal(m.calls.generation,1);assert.equal(f.comments.length,1);
  assert.equal((await store.get(PENDING)).jobs[1].blocked,'issue_unavailable');
});

test('lease excludes overlapping workers, expires after a crash, and fences the old worker',async()=>{
  const f=fixture(); let now=1000;
  const options={now:()=>now,ttl:100,interval:100000};
  const a=await acquireLease(f.store(),options);
  await assert.rejects(acquireLease(f.store(),options),{code:'checkpoint_busy'});
  now+=101;
  const b=await acquireLease(f.store(),options);
  await assert.rejects(a.check(),{code:'checkpoint_lease_lost'});
  await assert.rejects(a.release(),{code:'checkpoint_lease_lost'});
  await b.check(); await b.release();
});

test('checkpoint save failure stops before subsequent work and does not mark the step complete',async()=>{
  const state={}; let calls=0;
  const cp=createCheckpoint(state,async()=>{throw new Error('storage offline');});
  await assert.rejects(cp.run('generation',async()=>{calls++;return {ok:true};}),/storage offline/);
  assert.equal(calls,1); assert.deepEqual(state.steps,{});
});

test('cold continuation reuses persisted windows, terms and trees without fetching source blobs again',async()=>{
  const context = require('../context-windows'), originalTerms = context.terms;
  let tokenized = 0;
  context.terms = text => { tokenized++; return originalTerms(text); };
  try {
  const f=fixture(); let d=coldDiscovery();
  const first=await d.collectSources(f.api,config,1,undefined,{store:f.store()});
  const trees=f.calls.trees, blobs=f.calls.blobs.length;
  assert.equal(tokenized,2);
  d=coldDiscovery();
  const again=await d.collectSources(f.api,config,1,first.repositories,{store:f.store()});
  assert.deepEqual(again,first); assert.equal(f.calls.trees,trees); assert.equal(f.calls.blobs.length,blobs);
  assert.equal(tokenized,2,'restored windows must not be tokenized again');
  f.privateRepo('beta');
  await assert.rejects(d.collectSources(f.api,config,1,first.repositories,{store:f.store()}),{code:'private_source'});
  assert.equal(f.calls.blobs.length,blobs);
  } finally { context.terms = originalTerms; }
});

test('an interrupted index resumes after its saved 16-file chunk with pinned source commits',async()=>{
  const f=fixture(40); f.failBlob('alpha-16'); let pinned;
  await assert.rejects(coldDiscovery().collectSources(f.api,config,1,undefined,{store:f.store(),onSnapshot:async p=>{pinned=p;}}),/interruption/);
  assert.equal(f.calls.blobs.length,17);
  const completed=f.calls.blobs.slice(0,16); f.failBlob(undefined);
  const result=await coldDiscovery().collectSources(f.api,config,2,pinned,{store:f.store()});
  assert.equal(result.totalFiles,40); assert.equal(f.calls.trees,2);
  assert.ok(f.calls.blobs.slice(17).every(sha=>!completed.includes(sha)));
  assert.equal(f.calls.blobs.length,41,'only the incomplete chunk is retried');
});

function modelFixture() {
  const calls={generation:0,broad:0,focused:0}; let failFocus=true;
  const candidate={title:'Related observations',kind:'interpretive',relationship:'The sources describe a shared observation.',
    limit:'The contexts differ and do not establish a shared cause.',words:[{term:'parallel observations',kind:'candidate',fit:'Describes the limited comparison.'}],
    evidence:{S1:'S1P1',S2:'S2P1'}};
  const openai={chat:{completions:{create:async request=>{
    const kind=request.response_format.json_schema.name;
    if(kind==='language_discovery') {calls.generation++;return {id:'draft-saved',choices:[{finish_reason:'stop',message:{content:JSON.stringify({connections:[candidate,{...candidate,title:'Another comparison'}]})}}]};}
    if(kind==='word_meaning_audit') {
      calls.focused++;
      if(failFocus && calls.focused===2)throw new Error('simulated provider interruption');
      return require('./helpers/word-response')(request);
    }
    calls.broad++;
    const data=JSON.parse(request.messages[1].content);
    return {id:`broad-${calls.broad}`,choices:[{finish_reason:'stop',message:{content:JSON.stringify({C1:{
      fields:Object.fromEntries(Object.entries(data.candidates[0].fields).map(([k,p])=>[k,{stance:'asserted',proposition:p,status:'pass',reason:'Test review.'}])),
      checks:Object.fromEntries(require('../comparison-audit').CHECKS.map(k=>[k,'pass'])),reason:'Test review.',passages:['S1P1','S2P1']
    }})}}]};
  }}}};
  return {openai,calls,recover:()=>{failFocus=false;}};
}

test('fresh handler resumes each saved model stage and edits one report; completed redelivery costs nothing',async()=>{
  const f=fixture(), m=modelFixture();
  await run(handler(f,m.openai),f.context());
  assert.match(f.comments[0].body,/could not finish/);
  assert.deepEqual(m.calls,{generation:1,broad:2,focused:2});
  const reads=f.calls.blobs.length; m.recover();
  await run(handler(f,m.openai),f.context());
  assert.deepEqual(m.calls,{generation:1,broad:2,focused:3});
  assert.equal(f.calls.blobs.length,reads); assert.equal(f.comments.length,1);
  assert.match(f.comments[0].body,/discovery-complete:v1/);
  assert.match(f.comments[0].body,/complete-reading:/);
  assert.match(f.comments[0].body,/All required checks passed/);
  await run(handler(f,m.openai),f.context());
  assert.deepEqual(m.calls,{generation:1,broad:2,focused:3});
});

test('a publication disconnect reuses the saved final report without another model call',async()=>{
  const f=fixture(),m=modelFixture();m.recover();f.failUpdate(true);
  await run(handler(f,m.openai),f.context());
  const calls={...m.calls};f.failUpdate(false);
  await run(handler(f,m.openai),f.context());
  assert.deepEqual(m.calls,calls);assert.equal(f.comments.length,1);assert.match(f.comments[0].body,/discovery-complete:v1/);
});

test('changed requests or newly private sources cannot reuse a paid checkpoint',async()=>{
  const f=fixture(),m=modelFixture();await run(handler(f,m.openai),f.context());
  const calls={...m.calls};
  const changed=f.context();changed.payload.issue.body='Changed meaning';
  await run(handler(f,m.openai),changed);
  assert.match(f.comments.at(-1).body,/changed since this job was saved/);assert.deepEqual(m.calls,calls);
  f.privateRepo('beta');await run(handler(f,m.openai),f.context());
  assert.match(f.comments[0].body,/configured source is private/);assert.deepEqual(m.calls,calls);
});

test('durable previews make no model calls and continue the same pinned batch',async()=>{
  const f=fixture(),m=modelFixture();
  await run(handler(f,m.openai),f.context(1,'[Discover language] preview'));
  assert.equal(m.calls.generation,0);assert.match(f.comments[0].body,/No model request/);
  m.recover();await run(handler(f,m.openai),f.context(2,'[Discover language] continue 1'));
  assert.equal(m.calls.generation,1);assert.equal(f.calls.blobs.length,2);
});

test('missing state permission stops before source collection or any paid call',async()=>{
  const f=fixture(),m=modelFixture();
  f.api.repos.createOrUpdateFileContents=async()=>{throw Object.assign(new Error('forbidden'),{status:403});};
  await run(handler(f,m.openai),f.context());
  assert.deepEqual(m.calls,{generation:0,broad:0,focused:0});assert.equal(f.calls.blobs.length,0);
  assert.match(f.comments[0].body,/Contents write permission/);
});

test('failed focused verdict remains withheld after resuming another candidate',async()=>{
  const f=fixture(),m=modelFixture();let focused=0;
  const create=m.openai.chat.completions.create;
  m.openai.chat.completions.create=async request=>{
    const result=await create(request);
    if(request.response_format.json_schema.name==='word_meaning_audit' && ++focused===1) {
      const content=JSON.parse(result.choices[0].message.content);
      content.word_1.status='fail';
      content.word_1.reason='The proposed meaning is unsupported.';
      result.choices[0].message.content=JSON.stringify(content);
    }
    return result;
  };
  await run(handler(f,m.openai),f.context());m.recover();
  await run(handler(f,m.openai),f.context());
  assert.deepEqual(m.calls,{generation:1,broad:2,focused:3});
  assert.match(f.comments[0].body,/Withheld/);
  const receipt=JSON.parse(Buffer.from(/<!-- publication-receipt:([A-Za-z0-9+/=]+) -->/.exec(f.comments[0].body)[1],'base64'));
  assert.equal(receipt.decisions[0].accepted,false);
  assert.ok(receipt.decisions[0].failed.includes('word_meaning'));
  assert.equal(receipt.decisions[1].accepted,true);
});

test('first-use state branch is orphaned and cannot target the deploy branch',async()=>{
  const f=fixture();let treeInput,commitInput,refInput;
  f.api.git.getRef=async()=>{throw missing();};
  f.api.git.createBlob=async()=>({data:{sha:'readme'}});
  f.api.git.createTree=async p=>{treeInput=p;return {data:{sha:'tree'}};};
  f.api.git.createCommit=async p=>{commitInput=p;return {data:{sha:'root'}};};
  f.api.git.createRef=async p=>{refInput=p;return {data:{}};};
  await f.store().set('test',{ok:true});
  assert.deepEqual(commitInput.parents,[]);assert.equal(treeInput.tree.length,1);
  assert.equal(treeInput.tree[0].path,'README.txt');assert.equal(refInput.ref,`refs/heads/${BRANCH}`);
  f.api.repos.get=async()=>({data:{default_branch:BRANCH}});
  await assert.rejects(f.store().get('test'),{code:'checkpoint_branch'});
});

test('large state object retrieval uses its Git blob and never treats a missing blob as an empty job',async()=>{
  const f=fixture();await f.store().set('large',{text:'checkpoint'});
  const get=f.api.repos.getContent;
  let content;
  f.api.repos.getContent=async p=>{const r=await get(p);content=r.data.content;return {data:{...r.data,content:'',encoding:'none'}};};
  f.api.git.getBlob=async()=>({data:{encoding:'base64',content}});
  assert.deepEqual(await f.store().get('large'),{text:'checkpoint'});
  f.api.git.getBlob=async()=>{throw missing();};
  await assert.rejects(f.store().get('large'),{status:404});
});
