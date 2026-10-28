const {hash} = require('./discovery-state');

const PENDING = 'discovery/pending-jobs-v1';
const requestHash = issue => hash({title:issue.title,body:issue.body || ''});
const jobKey = (config, number) => `job/${config.owner}/${config.controlRepository}/${number}`;
function registry(value) {
  if (value === undefined) return {version:1,jobs:{}};
  if (value.version !== 1 || !value.jobs || typeof value.jobs !== 'object' || Array.isArray(value.jobs)
    || Object.entries(value.jobs).some(([id,j]) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))
      || !j || !/^[a-f0-9]{64}$/.test(j.requestHash)))
    throw Object.assign(new Error('Invalid recovery registry'),{code:'checkpoint_registry'});
  return value;
}
async function rememberJob(store, issue) {
  await store.update(PENDING, previous => {
    const value=registry(previous);
    value.jobs[issue.number]={requestHash:requestHash(issue),queuedAt:value.jobs[issue.number]?.queuedAt || Date.now()};
    return value;
  });
}
async function forgetJob(store, number) {
  await store.update(PENDING, previous => {const value=registry(previous);delete value.jobs[number];return value;});
}

// Only registered, previously owner-authorized jobs are eligible. The ordinary
// handler still enforces input fingerprints, public access and the shared lease.
function createRecoveryWorker({getClient,config,handler,log,now=Date.now,interval=30000,
  schedule=setTimeout,cancel=clearTimeout}) {
  let busy=false, stopped=true, timer, failures=0;
  const safeCode = error => /^[a-z_]{1,64}$/.test(error?.code || '') ? error.code : undefined;
  async function tick() {
    if (busy) return;
    busy=true;
    try {
      const {octokit,store}=await getClient();
      const jobs=Object.entries(registry(await store.get(PENDING)).jobs)
        .filter(([,job])=>!job.blocked).sort((a,b)=>(a[1].queuedAt || 0)-(b[1].queuedAt || 0));
      for (const [id,entry] of jobs) {
        // A live owner, including an old instance draining during deployment,
        // must finish or expire before recovery can take over.
        const lease=await store.get('discovery/lease');
        if (lease?.expires > now()) break;
        const number=Number(id), state=await store.get(jobKey(config,number));
        if (state && !['running','ready'].includes(state.status)) {await forgetJob(store,number);continue;}
        const block=async reason => {
          await store.update(PENDING, previous => {
            const value=registry(previous);
            if(value.jobs[id]?.requestHash===entry.requestHash) value.jobs[id].blocked=reason;
            return value;
          });
          log?.warn?.({issue:number,code:reason},'Automatic discovery recovery needs attention');
        };
        let issue;
        try {({data:issue}=await octokit.issues.get({owner:config.owner,repo:config.controlRepository,issue_number:number}));}
        catch(error) {if(error.status===404){await block('issue_unavailable');continue;}throw error;}
        if (issue.state !== 'open' || issue.pull_request || issue.user?.type === 'Bot') {await block('issue_closed');continue;}
        if (requestHash(issue)!==entry.requestHash) {
          await block('checkpoint_changed');
          await octokit.issues.createComment({owner:config.owner,repo:config.controlRepository,issue_number:number,
            body:'# Automatic recovery paused\nThis request changed after its checkpoints were saved. Restore the original title and body and reopen it, or start a new discovery request. Saved checkpoints were preserved.'});
          continue;
        }
        const {data:repository}=await octokit.repos.get({owner:config.owner,repo:config.controlRepository});
        const context={octokit,automaticRecovery:true,recoveryStore:store,
          issue:()=>({owner:config.owner,repo:config.controlRepository,issue_number:number}),
          payload:{issue,repository,sender:{login:config.owner,type:'User'}}};
        try {
          log?.info?.({issue:number},'Automatically resuming saved discovery job');
          await handler.handle(context);
          await handler.waitForIdle();
          // Covers a crash after the final comment was published but before
          // the pending entry was removed, and terminal paused jobs.
          const saved=await store.get(jobKey(config,number));
          if (saved && ['complete','paused'].includes(saved.status)) await forgetJob(store,number);
        } catch(error) {
          if (['checkpoint_busy','checkpoint_conflict','checkpoint_lease_lost'].includes(error.code)) break;
          if (['checkpoint_changed','checkpoint_legacy','checkpoint_ambiguous'].includes(error.code)) {
            await block(error.code);
            await octokit.issues.createComment({...context.issue(),body:'# Automatic recovery paused\nThe saved request or review rules no longer match. Restore the original inputs and reopen this issue, or start a new discovery request. Saved checkpoints were preserved.'});
          } else throw error;
        }
      }
      failures=0;
    } catch(error) {
      failures=Math.min(failures+1,4);
      log?.error?.({code:safeCode(error),status:Number.isInteger(error.status)?error.status:undefined},'Automatic discovery recovery check failed');
    } finally {busy=false;}
  }
  function arm(delay) {
    timer=schedule(async()=>{await tick();if(!stopped)arm(Math.min(300000,interval*2**failures));},delay);
    timer.unref?.();
  }
  return {tick,start(){if(!stopped)return;stopped=false;arm(5000);},stop(){stopped=true;cancel(timer);}};
}

module.exports={PENDING,requestHash,jobKey,rememberJob,forgetJob,createRecoveryWorker};
