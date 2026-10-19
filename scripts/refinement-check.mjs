import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const svf=process.env.SVF_ROOT||resolve(root,'../SVF');
const llvm=process.env.LLVM_ROOT||`${svf}/llvm-21.1.0.obj`;
function run(command,args) {
  const p=spawnSync(command,args,{cwd:root,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr||p.error?.message);return p.stdout.trim();
}
mkdirSync(`${root}/build/refinement-proof`,{recursive:true});
run(`${llvm}/bin/clang`,['-O0','-g','-fwrapv','-fno-discard-value-names','-Xclang','-disable-O0-optnone','-emit-llvm','-c','examples/core-irrelevant-prefix.c','-o','build/core-prefix.raw.bc']);
run(`${llvm}/bin/opt`,['-passes=mem2reg','build/core-prefix.raw.bc','-o','build/core-prefix.bc']);
run(`${root}/build/svf-cegar`,['build/core-prefix.bc','examples/core-irrelevant-prefix.c','build/core-prefix.json']);
const regression=JSON.parse(readFileSync(`${root}/build/core-prefix.json`));
assert.equal(regression.verdict,'SAFE');assert.equal(regression.rounds.length,2);
const first=regression.rounds[0];
assert.ok(first.refinement.ignored.some(c=>c.formula.includes('input_0')),'Unrelated first branch must be excluded');
assert.ok(first.learnedPredicates.every(p=>!p.includes('input_0')),'Do not learn the first branch');
const examples=JSON.parse(readFileSync(`${root}/site/dist/data/results.json`)).examples;
const relational=examples.find(e=>e.id==='relational');
assert.equal(relational.inputs.length,2);
assert.deepEqual(relational.rounds[0].learnedPredicates,['input_0 > input_1']);
assert.deepEqual(relational.rounds[0].refinement.core.map(c=>c.formula),['input_0 > input_1','input_0 <= input_1']);
assert.ok(relational.rounds[0].refinement.reductions.some(c=>c.relation==='complement'));
assert.equal(relational.rounds[1].outcome,'safe');
assert.equal(examples.find(e=>e.id==='arithmetic').rounds[0].learnedPredicates.length,2);
assert.ok(examples.find(e=>e.id==='contradiction').rounds[0].refinement.reductions.some(c=>c.relation==='complement'));
let checks=0,rounds=0;
for(const ex of [...examples,regression])for(const [i,r] of ex.rounds.entries()) {
  if(r.outcome!=='unsat')continue;
  rounds++;
  const proof=r.refinement;
  const sessionPath=`${root}/build/refinement-proof/session-${rounds}.smt2`;
  writeFileSync(sessionPath,r.z3Session);
  const response=run(`${root}/build/smt-replay`,['--session',sessionPath]);
  assert.match(response,/^unsat\s+\(/);
  assert.deepEqual([...response.matchAll(/edge_\d+/g)].map(m=>m[0]).sort(),[...r.reportedCore].sort(),'Replayed session must reproduce the returned core');
  assert.equal(r.z3Response,`unsat\n(${r.reportedCore.join(' ')})`);
  assert.equal(proof.method,'smt-unsat-core');assert.equal(proof.coreMinimal,true);
  assert.equal(r.pathEliminated,true);
  assert.deepEqual(ex.rounds[i+1].predicates,[...r.predicates,...r.learnedPredicates]);
  assert.ok(proof.added.every(a=>proof.core.some(c=>c.edge===a.edge&&c.formula===a.formula)));
  assert.deepEqual(proof.coverage.map(c=>c.valuation),Array.from({length:2**ex.rounds[i+1].predicates.length},(_,k)=>k));
  for(const c of proof.coverage)assert.ok(c.infeasible||proof.core.some(k=>k.edge===c.blockedEdge));
  for(const obligation of proof.obligations) {
    const path=`${root}/build/refinement-proof/check-${++checks}.smt2`;
    writeFileSync(path,obligation.smtlib);
    assert.equal(run(`${root}/build/smt-replay`,[path]),obligation.expected,obligation.purpose);
  }
}
console.log(`Verified ${rounds} refinements; replayed ${checks} SMT obligations in fresh Z3 processes. Irrelevant first branch excluded.`);
