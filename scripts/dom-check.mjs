import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
// Reuse an existing installation. This command does not install dependencies.
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||resolve(import.meta.dirname,'../build/ui-tests/node_modules/jsdom'));
const root=resolve(import.meta.dirname,'..'),errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
const html=readFileSync(`${root}/site/dist/state-columns.html`,'utf8')
  .replace('<script defer src="data/results.js"></script>','')
  .replace('<script defer src="model.js"></script>','')
  .replace('<script defer src="app.js"></script>','')
  .replace('</body>',()=>`<script>${readFileSync(`${root}/site/dist/data/results.js`,'utf8')}</script><script>${readFileSync(`${root}/site/dist/model.js`,'utf8')}</script><script>${readFileSync(`${root}/site/dist/app.js`,'utf8')}</script></body>`);
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc});
const {window:w}=dom,doc=w.document;
const click=selector=>{const n=doc.querySelector(selector);assert.ok(n,selector);n.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
const text=id=>doc.getElementById(id).textContent;
for(let i=0;i<5;i++) {
  click(`[data-example="${i}"]`);
  assert.equal(doc.querySelectorAll('[aria-selected="true"]').length,1);
  let count=0;
  while(!doc.getElementById('next').disabled) {click('#next');assert.ok(++count<20);}
  assert.ok(text('state-badge').includes(['SAFE','SAT','SAFE','SAFE','UNKNOWN'][i]));
  if(i===1) {assert.equal(doc.querySelector('.witness').textContent,'x = 1');assert.ok(text('solver-content').includes('Confirmed by executing'));}
  if(i===3) assert.equal(doc.querySelectorAll('.predicate').length,2);
  if(i<4) {
    click('[data-node]');assert.ok(doc.getElementById('node-inspector').open);assert.ok(text('node-detail').length>0);assert.doesNotMatch(text('node-inspector'),/ICFG|(?:node|Node)\s*\d/);
    click('[data-source="llvm"]');assert.match(text('source'),/define/);
    click('[data-source="c"]');assert.match(text('source'),/int main/);
    for(const e of doc.querySelectorAll('svg path'))assert.ok(!e.getAttribute('d')?.includes('NaN'));
  }
  click('#reset');assert.equal(text('step-count').split(' / ')[0],'1');
}
click('[data-example="0"]');
click('#next');click('#next');assert.equal(doc.querySelectorAll('.solver-box:not(details) .constraint.core').length,2);
click('#next');click('#next');assert.equal(doc.querySelectorAll('.graph-edge.cut').length,1);
click('[data-example="3"]');while(!doc.getElementById('next').disabled)click('#next');
assert.equal(doc.querySelectorAll('.graph-edge.cut').length,2);
click('#show-smt');assert.ok(doc.getElementById('smt-output').classList.contains('visible'));
// Inspect complete model snapshots and compare the last two iterations.
const examples=w.CEGAR_RESULTS.examples;
for(let i=0;i<4;i++) {
  click(`[data-example="${i}"]`);
  assert.equal(doc.querySelectorAll('[data-model-round]').length,examples[i].rounds.length);
  if(!doc.getElementById('model-all-nodes').checked) {
    doc.getElementById('model-all-nodes').checked=true;
    doc.getElementById('model-all-nodes').dispatchEvent(new w.Event('change'));
  }
  for(const r of examples[i].rounds) {
    click(`[data-model-round="${r.index}"]`);
    assert.equal(doc.querySelectorAll('.abstract-state').length,r.explored.length,'All reachable states must be rendered');
    assert.equal(doc.querySelectorAll('.model-transition:not(.rejected)').length,r.transitions.length,'All permitted transitions must be rendered');
    assert.equal(doc.querySelector('[data-model-panel]').dataset.modelPanel,String(r.index));
    click('[data-abstract-state]');assert.match(text('model-state-detail'),/SELECTED ABSTRACT STATE/);
    for(const selector of ['#model-lab','#model-state-detail','#graph','#node-inspector']) {
      const region=doc.querySelector(selector);
      assert.doesNotMatch(region.textContent,/ICFG|(?:node|Node)\s*\d/);
      for(const el of region.querySelectorAll('[aria-label]'))assert.doesNotMatch(el.getAttribute('aria-label'),/ICFG|(?:node|Node)\s*\d/);
    }
    for(const shape of doc.querySelectorAll('#model-canvases path'))assert.ok(!shape.getAttribute('d')?.includes('NaN'));
  }
  if(examples[i].rounds.length>1) {
    click('#model-compare');assert.equal(doc.querySelectorAll('[data-model-panel]').length,2);
    const indices=[...doc.querySelectorAll('[data-model-panel]')].map(el=>Number(el.dataset.modelPanel));
    assert.deepEqual(indices,[examples[i].rounds.length-2,examples[i].rounds.length-1]);
    click('#model-single');assert.equal(doc.querySelectorAll('[data-model-panel]').length,1);
  }
}
click('[data-example="0"]');click('[data-model-round="1"]');
assert.equal(doc.querySelectorAll('.abstract-state.error').length,0);
assert.ok(doc.querySelectorAll('.abstract-ghost').length>0);
// Program, model and predicates are now siblings in one iteration workspace.
assert.ok(doc.querySelector('.workspace > .source-pane'));
assert.ok(doc.querySelector('.workspace > #model-lab'));
assert.ok(doc.querySelector('.workspace > .reasoning-pane'));
const picked=[...doc.querySelectorAll('[data-abstract-state]')].find(el=>{
  const [,id,mask]=el.dataset.abstractState.split(':').map(Number);
  return mask===1&&examples[0].nodes.find(n=>n.id===id)?.line>0;
});
assert.ok(picked);picked.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
assert.equal(doc.querySelector('.predicate-value').textContent,'TRUE');
assert.ok(doc.querySelector('#source .code-line.active'));
doc.getElementById('model-rejected').checked=false;
doc.getElementById('model-rejected').dispatchEvent(new w.Event('change'));
assert.equal(doc.querySelectorAll('.model-transition.rejected').length,0);
click('[data-example="4"]');assert.equal(doc.querySelectorAll('[data-abstract-state]').length,0);
assert.match(text('model-change'),/No abstract model/);
assert.equal(errors.length,0,errors.map(String).join('\n'));
console.log('DOM checks passed: playback, evidence, every complete abstract model, before/after comparison, state inspection, all ICFG locations, rejected-edge toggle, and UNKNOWN handling. Use browser-review.py for rendered layout checks.');
w.close();
