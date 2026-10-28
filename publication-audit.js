// One gate for discovery, saved findings and on-demand comparison examples.
const {auditConnections,comparisonModel}=require('./comparison-audit');
const {validConfidence}=require('./confidence');
async function auditPublicationCandidates(openai,model,candidates,catalog,log,onError,checkpoint) {
  const decisions = await auditConnections(openai, model, candidates, catalog, log, checkpoint);
  for (const [i,c] of candidates.entries()) {
    const fits = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
    const formatSafe = fits(c.title,120) && fits(c.relationship,1500) && fits(c.limit,1500)
      && Array.isArray(c.words) && c.words.length >= 1 && c.words.length <= 3
      && c.words.every(w => fits(w?.term,90) && fits(w?.fit,500) && ['candidate','coined'].includes(w.kind));
    // Never turn a fully reviewed sentence into a different one by clipping it.
    if (!formatSafe && decisions[i]) { decisions[i].accepted = false; decisions[i].failed.push('publication_format'); }
    const refs = Array.isArray(c.evidence) ? c.evidence : Object.entries(c.evidence || {}).filter(([,id]) => id !== null).map(([source,passage]) => ({ source, passage }));
    const matched = refs.map(r => catalog.find(p => p.id === r.passage && p.quote.length >= 15 && p.source.id === r.source)).filter(Boolean);
    if (new Set(matched.map(r => r.source.id)).size < 2 || !['observed','interpretive','creative'].includes(c.kind)
      || (c.confidence !== undefined && !validConfidence(c.confidence))) {
      if (decisions[i]) { decisions[i].accepted = false; decisions[i].failed.push('publication_evidence'); }
    }
  }
  return applyFocusedChecks(openai,model,candidates,catalog,log,decisions,onError,checkpoint);
}

// Historical single-source exercises do not become cross-file discoveries.
// Every candidate that survives the broad reader must also pass the focused
// lexical AND contextual reader below. No option disables that second stage.
async function auditSemanticCandidates(openai,model,candidates,catalog,log) {
  const decisions=await auditConnections(openai,model,candidates,catalog,log);
  return applyFocusedChecks(openai,model,candidates,catalog,log,decisions);
}

async function applyFocusedChecks(openai,model,candidates,catalog,log,decisions,onError,checkpoint) {
  // A prior rejection cannot be rescued. A broad pass is provisional until
  // auditWordMeanings supplies both lexical and all-field contextual decisions.
  for (const [i,c] of candidates.entries()) {
    if (!decisions[i]?.accepted) continue;
    let wordAudit;
    try {
      const work = () => require('./word-meaning-audit').auditWordMeanings(openai,comparisonModel(model),c,catalog,log);
      wordAudit = checkpoint ? await checkpoint.run(`focused-${i}`, work) : await work();
    } catch(error) {
      if (onError) onError(error, {index:i, decisions});
      throw error;
    }
    decisions[i].wordAudit = wordAudit;
    decisions[i].checks.word_meaning = wordAudit.accepted ? 'pass' : 'fail';
    decisions[i].checks.contextual_fidelity = Object.values(wordAudit.claimFields||{}).length>0
      && Object.values(wordAudit.claimFields).every(r=>r.status==='pass') ? 'pass' : 'fail';
    if(!wordAudit.accepted) {
      decisions[i].accepted = false;
      decisions[i].failed.push('word_meaning');
      decisions[i].reason += ' ' + Object.entries(wordAudit.fields).filter(([,v])=>v.status!=='pass').map(([k,v])=>`${k}: ${v.reason||'Incomplete word meaning review.'}`).join(' ');
      const failedClaims=Object.entries(wordAudit.claimFields||{}).filter(([,v])=>v.status!=='pass');
      if(decisions[i].checks.contextual_fidelity!=='pass') decisions[i].failed.push('contextual_fidelity');
      decisions[i].reason += ' '+failedClaims.map(([k,v])=>`${k}: ${v.reason}`).join(' ');
    }
  }
  return decisions;
}
module.exports={auditPublicationCandidates,auditSemanticCandidates};
