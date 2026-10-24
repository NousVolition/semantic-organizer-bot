const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectContext}=require('../context-windows');
test('retrieval recovers earlier definitions, adjacent proof and a cross-file lead without changing primary coverage',()=>{
 const a={parts:[{text:'Heliolatch denotes reversible orbital custody.'},{text:'Unrelated historical narrative.'},{text:'Heliolatch supports orbital custody in this proposal.'},{text:'The adjacent derivation limits the claim to an initial identity.'}]};
 const b={parts:[{text:'Orbital custody appears as a distinct relational metaphor.'}]};
 const filler=Array.from({length:16},(_,i)=>({parts:[{text:`Other material ${i}: ordinary narrative with no shared distinctive terms.`}]}));
 const units=[a,b,...filler].flatMap(document=>document.parts.map((_,depth)=>({document,depth})));
 const primary=[units[2]],before=[...primary],result=selectContext(units,primary);
 assert.deepEqual(primary,before);assert.ok(result.length<=4);
 assert.ok(result.some(x=>x.unit.document===a&&x.unit.depth===0));
 assert.ok(result.some(x=>x.unit.document===a&&x.unit.depth===3));
 assert.ok(result.some(x=>x.unit.document===b));
 assert.equal(new Set(result.map(x=>x.unit)).size,result.length);assert.ok(result.every(x=>!primary.includes(x.unit)));
});
test('generic vocabulary is not a cross-document lead and bounds are enforced',()=>{
 const units=Array.from({length:8},()=>({document:{parts:[{text:'This is the same ordinary narrative in every document.'}]},depth:0}));
 assert.deepEqual(selectContext(units,[units[0]]),[]);
 assert.deepEqual(selectContext(units,[units[0]],0),[]);
 assert.throws(()=>selectContext(units,[units[0]],5));
});
