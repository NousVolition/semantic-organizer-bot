const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {hash, acquireLease, createCheckpoint} = require('./discovery-state');
const {comparisonModel} = require('./comparison-audit');
const {rememberJob,forgetJob} = require('./discovery-recovery');

// Changes to instructions, validation or selection invalidate paid checkpoints;
// unrelated deploys do not. Never silently reinterpret a saved model decision.
const revision = hash(['discovery.js','complete-reading.js','context-windows.js',
  'comparison-audit.js','publication-audit.js','word-meaning-audit.js','confidence.js',
  'contextual-fidelity.js','corpus-knowledge.js','wording-fidelity.js','semantic-lenses.js',
  'corpus-definitions.md','semantic-lenses.md','drift-scan.js','discovery-session.js',
  'discovery-state.js'].map(name => readFileSync(join(__dirname,name),'utf8')));
const DONE = '<!-- discovery-complete:v1 -->';

async function openSession({store, octokit, params, marker, comments, config, model, skills, driftScanner, issue}) {
  const reports = comments.filter(c => c.user?.type === 'Bot' && c.body?.startsWith(marker));
  if (reports.some(c => c.body.includes(DONE) || c.body.includes('<!-- complete-reading:'))) {
    await forgetJob(store,issue.number); return null;
  }
  if (reports.length > 1) throw Object.assign(new Error('Ambiguous status comments'), {code:'checkpoint_ambiguous'});
  const lease = await acquireLease(store);
  try {
    const key = `job/${config.owner}/${config.controlRepository}/${issue.number}`;
    const fingerprint = hash({revision,config,model,reviewModel:comparisonModel(model),skills,
      drift:typeof driftScanner === 'function',title:issue.title,body:issue.body || ''});
    let state = await store.get(key);
    if (state?.status === 'complete') { await lease.release(); return null; }
    if (state && (state.version !== 1 || state.fingerprint !== fingerprint))
      throw Object.assign(new Error('Saved job inputs changed'), {code:'checkpoint_changed'});
    // Legacy status comments contain no resumable stage data. Refuse to guess
    // whether they had already made paid calls before this feature existed.
    if (!state && reports.length) throw Object.assign(new Error('Legacy job has no checkpoint'), {code:'checkpoint_legacy'});
    state ||= {version:1,fingerprint,status:'running',steps:{}};
    // Register before starting work. A crash even before the first job write
    // leaves an owner-authorized request that startup recovery can discover.
    await rememberJob(store,issue);
    await store.set(key,state);
    let comment = reports[0];
    if (!comment) {
      const result = await octokit.issues.createComment({...params,body:`${marker}\nReading public sources. Progress is saved after each completed indexing chunk and review step. Interrupted jobs resume automatically after a service restart.`});
      comment = result.data;
    }
    if (!comment.id) throw new Error('Missing recovery comment ID');
    state.commentId = comment.id;
    state.status = 'running';
    const save = async () => { await lease.check(); await store.set(key,state); };
    await save();
    const checkpoint = createCheckpoint(state,save,lease.check);
    return {store,state,checkpoint,save,lease,comment:{data:comment},
      async finish(body,success) {
        state.status = success ? 'ready' : 'paused';
        await save();
        await lease.check();
        await octokit.issues.updateComment({owner:params.owner,repo:params.repo,comment_id:state.commentId,
          body:`${marker}\n${body}${success ? `\n${DONE}` : '\n\nCompleted checkpoints are saved. Resolve the reported error, then close and reopen this issue to retry with the same inputs. This paused job will not retry paid calls automatically.'}`});
        if (success) { state.status = 'complete'; await save(); }
        await forgetJob(store,issue.number);
      }
    };
  } catch (error) { await lease.release().catch(() => {}); throw error; }
}

module.exports = {openSession,DONE};
