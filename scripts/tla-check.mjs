import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const models=JSON.parse(readFileSync(new URL('../site/dist/models/manifest.json',import.meta.url),'utf8'));
const key=(pc,mask)=>JSON.stringify([pc,mask]);
function evaluate(guard,mask) {
  const expr=guard.replace(/p(\d+)/g,(_,i)=>String(Boolean(mask&(1<<Number(i))))).replaceAll('TRUE','true').replaceAll('FALSE','false').replaceAll('/\\','&&').replaceAll('\\/','||').replaceAll('~','!');
  assert.match(expr,/^[truefals\s()!&|]+$/);
  return vm.runInNewContext(expr,{}, {timeout:100});
}
for(const model of models) {
  const source=readFileSync(new URL(`../site/dist/models/${model.module}.tla`,import.meta.url),'utf8');
  assert.equal(source,model.source);
  assert.match(source,/Spec == Init \/\\ \[\]\[Next\]_vars/);
  const actions=[...source.matchAll(/^    \\\/ Step\(("[^"]*"), ("[^"]*"), (.*)\)$/gm)].map(m=>({from:JSON.parse(m[1]),to:JSON.parse(m[2]),guard:m[3]}));
  assert.equal(actions.length,model.actions.length);
  actions.forEach((a,i)=>{
    for(let m=0;m<2**model.predicates.length;m++)assert.equal(evaluate(a.guard,m),model.actions[i].masks.includes(m),'Exported Boolean guard must encode exactly the recorded transitions');
  });
  const visited=new Set(),queue=model.initialMasks.map(mask=>({pc:model.entry,mask}));
  while(queue.length) {
    const state=queue.shift(),id=key(state.pc,state.mask);if(visited.has(id))continue;visited.add(id);
    for(const a of actions.filter(a=>a.from===state.pc))if(evaluate(a.guard,state.mask))queue.push({pc:a.to,mask:state.mask});
  }
  assert.deepEqual([...visited].sort(),model.states.map(s=>key(s.pc,s.mask)).sort(),'Exploring exported Next must match the recorded block-state projection');
  const errorSet=source.match(/NoError == pc \\notin \{(.*)\}/)[1];
  const errors=JSON.parse('['+errorSet+']');
  assert.equal(![...visited].some(id=>errors.includes(JSON.parse(id)[0])),model.expectedSafe);
  if(model.round>0) {
    const prev=models.find(m=>m.example===model.example&&m.round===model.round-1),previousStates=new Set(prev.states.map(s=>key(s.pc,s.mask)));
    const lowBits=(1<<prev.predicates.length)-1;
    for(const id of visited){const [pc,mask]=JSON.parse(id);assert.ok(previousStates.has(key(pc,mask&lowBits)),'Refined states project into the previous model');}
  }
  assert.match(model.configuration,/CHECK_DEADLOCK FALSE/);
}
console.log(`Checked ${models.length} TLA+ exports: Boolean guards, reachable states, ERROR verdicts, refinement projection, and matching file contents. This is not a TLC/SANY run.`);
