// Deterministic retrieval hints, not semantic judgments. Selection never changes
// the primary coverage schedule or supplies an invented definition/relationship.
const STOP=new Set(('about after again against also among another because before being between both cannot could does each either even every first following from further have here into itself latter merely might more most much must neither only other ours over same shall should since some stated still such than that their them then there these they this those through under unless until upon used uses using very were what when where which while whose will with within without would your').split(' '));
function terms(text) {
  return new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}][\p{L}\p{N}_-]{3,}/gu)||[]).filter(t=>!STOP.has(t)));
}
function indexContext(units, savedDf) {
  const df = savedDf ? new Map(savedDf) : new Map();
  const indexed = units.map(u => ({u, t: new Set(u.document.parts[u.depth].terms || terms(u.document.parts[u.depth].text))}));
  if (!savedDf) for (const {t} of indexed) for (const token of t) df.set(token, (df.get(token)||0)+1);
  return { indexed, df };
}
function selectContext(units,primary,limit=4,index=indexContext(units)) {
  if(!Number.isInteger(limit)||limit<0||limit>4)throw new Error('Invalid context window limit');
  if(!limit||!primary.length)return [];
  const selected=new Set(primary),query=new Set();
  const {indexed,df}=index;
  for(const {u,t} of indexed) {
    if(selected.has(u))for(const token of t)query.add(token);
  }
  const documents=new Set(primary.map(u=>u.document));
  const ranked=indexed.filter(({u})=>!selected.has(u)).map(({u,t},order)=>{
    const shared=[...t].filter(token=>query.has(token)&&df.get(token)<=Math.max(2,Math.ceil(units.length*0.2)));
    const score=shared.reduce((n,token)=>n+Math.log(1+units.length/df.get(token)),0);
    const adjacent=primary.some(p=>p.document===u.document&&Math.abs(p.depth-u.depth)===1);
    return {u,shared,score,adjacent,cross:!documents.has(u.document),order};
  });
  const chosen=[];
  const add=(r,reason)=>{if(r&&chosen.length<limit&&!chosen.some(x=>x.unit===r.u))chosen.push({unit:r.u,reason,sharedTerms:r.shared.slice(0,8)});};
  // Reserve up to two slots for immediate context (before and after when one
  // primary window is read), then a cross-document lead and distant definitions.
  ranked.sort((a,b)=>b.score-a.score||a.order-b.order);
  for(const r of ranked.filter(r=>r.adjacent).slice(0,2))add(r,'adjacent context');
  add(ranked.find(r=>r.cross&&r.shared.length>=2),'cross-document shared terms');
  for(const r of ranked)if(r.shared.length>=2)add(r,'shared terms');
  return chosen;
}
module.exports={selectContext,indexContext,terms};
