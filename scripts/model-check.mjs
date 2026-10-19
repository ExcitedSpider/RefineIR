import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const data=JSON.parse(readFileSync(`${root}/site/dist/data/results.json`));
const key=s=>`${s.node}:${s.valuation}`;
let count=0;
for(const ex of data.examples) {
  for(const [index,r] of ex.rounds.entries()) {
    count++;
    assert.equal(r.modelComplete,true);
    const states=new Set(r.explored.map(key)),errors=new Set(ex.nodes.filter(n=>n.kind==='error').map(n=>n.id));
    const allowed=new Set(r.transitions.map(t=>`${t.edge}:${t.valuation}`));
    const rejected=new Set(r.blocked.map(t=>`${t.edge}:${t.valuation}`));
    assert.equal(states.size,r.explored.length,'Duplicate abstract states');
    const reached=new Set(r.initialStates.map(key));
    for(const initial of r.initialStates)assert.equal(initial.node,ex.entry);
    for(const t of r.transitions) {
      const edge=ex.edges[t.edge];assert.equal(edge.from,t.from);assert.equal(edge.to,t.to);
      assert.ok(states.has(key({node:t.from,valuation:t.valuation})));
      assert.ok(states.has(key({node:t.to,valuation:t.valuation})));
      assert.ok(!rejected.has(`${t.edge}:${t.valuation}`));
      assert.ok(!errors.has(t.from),'ERROR must be terminal');
    }
    let changed=true;
    while(changed) {
      changed=false;
      for(const t of r.transitions) {
        const from=key({node:t.from,valuation:t.valuation}),to=key({node:t.to,valuation:t.valuation});
        if(reached.has(from)&&!reached.has(to)){reached.add(to);changed=true;}
      }
    }
    assert.deepEqual(reached,states,'Snapshot is not exactly the reachable closure');
    for(const s of r.explored) {
      if(errors.has(s.node))continue;
      for(const e of ex.edges.filter(e=>e.from===s.node)) {
        const k=`${e.id}:${s.valuation}`;
        assert.notEqual(allowed.has(k),rejected.has(k),'Every outgoing edge must have exactly one solver decision');
      }
    }
    if(r.path)for(const edge of r.path)assert.ok(allowed.has(`${edge}:${r.pathValuation}`),'Counterexample must belong to this abstract model');
    if(r.outcome==='safe')assert.ok(r.explored.every(s=>!errors.has(s.node)));
    if(index>0) {
      const prev=ex.rounds[index-1],mask=(1<<prev.predicates.length)-1;
      assert.deepEqual(r.predicates.slice(0,prev.predicates.length),prev.predicates);
      const oldStates=new Set(prev.explored.map(key)),oldEdges=new Set(prev.transitions.map(t=>`${t.edge}:${t.valuation}`));
      for(const s of r.explored)assert.ok(oldStates.has(key({node:s.node,valuation:s.valuation&mask})),'Refined state must project to a coarse state');
      for(const t of r.transitions)assert.ok(oldEdges.has(`${t.edge}:${t.valuation&mask}`),'Refined transition must project to a coarse transition');
    }
  }
}
console.log(`Model checks passed: ${count} complete reachable snapshots; transition decisions, counterexample valuations, and refinement projections are consistent.`);
