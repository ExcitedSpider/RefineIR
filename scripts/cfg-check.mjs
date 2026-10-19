import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {JSDOM,VirtualConsole}=require(process.env.JSDOM_PATH||resolve(import.meta.dirname,'../build/ui-tests/node_modules/jsdom'));
const read=p=>readFileSync(new URL('../site/dist/'+p,import.meta.url),'utf8');
const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e));
assert.equal(read('index.html'),read('cfg.html'),'Existing CFG bookmarks must keep working');
const html=read('index.html').replace(/<script defer src="[^"]+"><\/script>/g,'').replace('</body>',()=>['data/results.js','model.js','cfg.js','tla.js','app.js'].map(p=>`<script>${read(p)}</script>`).join('')+'</body>');
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'http://localhost/index.html'}),w=dom.window,d=w.document;
const click=s=>{const el=d.querySelector(s);assert.ok(el,s);el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
let snapshots=0;
for(const [i,ex] of w.CEGAR_RESULTS.examples.entries()) {
  click(`[data-example="${i}"]`);
  assert.equal(d.querySelector('[data-source].active').dataset.source,'svf');
  if(ex.verdict==='UNKNOWN'){assert.equal(d.querySelectorAll('.cfg-block').length,0);assert.match(d.getElementById('source').textContent,/No mapped SVF listing/);continue;}
  let layout;
  for(const r of ex.rounds) {
    click(`[data-model-round="${r.index}"]`);
    const {graph}=w.CEGAR_CFG_SNAPSHOT;
    const source=d.getElementById('source');
    assert.deepEqual([...source.querySelectorAll('[data-svf-block]')].map(el=>el.dataset.svfBlock),[...d.querySelectorAll('[data-cfg-block]')].map(el=>el.dataset.cfgBlock),'Listing and graph must expose exactly the same blocks in the same order');
    assert.doesNotMatch(source.textContent,/!dbg|ICFG|ValVar|PhiStmt|φ\(|source_filename|attributes #/);
    for(const b of graph.blocks) {
      click(`[data-svf-block="${b.id}"]`);
      assert.equal(d.querySelector('.cfg-block.selected').dataset.cfgBlock,String(b.id),'Selecting the SVF source selects its graph block');
      assert.equal(source.querySelector('.svf-source-block.active').dataset.svfBlock,String(b.id));
      const rendered=[...source.querySelector(`[data-svf-block="${b.id}"]`).querySelectorAll('.svf-expression')].map(el=>el.textContent);
      assert.deepEqual(rendered,Array.from(b.rows,row=>row.text),'SVF source uses exactly the graph operations');
    }
    click(`[data-cfg-block="${graph.blocks[0].id}"]`);
    assert.equal(source.querySelector('.svf-source-block.active').dataset.svfBlock,String(graph.blocks[0].id),'Graph selection highlights the corresponding source block');
    const positions=JSON.stringify(graph.blocks.map(b=>[b.id,b.x,b.y,b.width,b.height]));
    if(layout)assert.equal(positions,layout,'CFG geometry must stay fixed across refinement');
    layout=positions;
    assert.doesNotMatch(d.querySelector('#model-lab').textContent,/ICFG|Var\d|predicate\d|opcode\d/);
    assert.ok(d.querySelector('#model-lab').textContent.includes('CmpStmt'));
    for(const b of graph.blocks) {
      assert.ok(b.rows.every(row=>row.type!=='unformatted operation'));
      for(const other of graph.blocks.filter(other=>other!==b))assert.ok(b.x+b.width<=other.x||other.x+other.width<=b.x||b.y+b.height<=other.y||other.y+other.height<=b.y,'Blocks overlap');
    }
    // Every chip corresponds to an actual reachable abstract state at block end.
    for(const chip of d.querySelectorAll('[data-cfg-fact]')) {
      const [id,m]=chip.dataset.cfgFact.split(':').map(Number),b=graph.blocks.find(b=>b.id===id);
      assert.ok(r.explored.some(s=>s.node===b.tail&&s.valuation===m));
    }
    for(const button of [...d.querySelectorAll('[data-cfg-mask]')]) {
      const m=Number(button.dataset.cfgMask);click(`[data-cfg-mask="${m}"]`);
      for(const edge of d.querySelectorAll('[data-cfg-edge]')) {
        const ids=edge.dataset.cfgEdge.split(',').map(Number);
        assert.equal(edge.dataset.permitted==='true',ids.every(id=>r.transitions.some(t=>t.edge===id&&t.valuation===m)));
      }
      const chip=d.querySelector(`[data-cfg-fact$=":${m}"]`);
      assert.ok(chip);chip.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
      assert.match(d.getElementById('model-state-detail').textContent,/SELECTED CFG BLOCK/);
      assert.equal(w.CEGAR_CFG_SNAPSHOT.mask,m);
    }
    const link=new URL(d.querySelector('[data-presentation]').href);
    assert.equal(link.pathname,'/state-columns.html');assert.equal(link.searchParams.get('example'),ex.id);
    snapshots++;
    if(process.env.CFG_EXPORT_DIR) {
      mkdirSync(process.env.CFG_EXPORT_DIR,{recursive:true});
      const svg=d.querySelector('.cfg-svg').cloneNode(true);
      const size=svg.getAttribute('viewBox').split(' ');svg.setAttribute('width',size[2]);svg.setAttribute('height',size[3]);
      const colors={'white':'#fffefa','ink':'#24342d','muted':'#68756d','green':'#376c48','red':'#b44d40','line':'#d9ddd4','mono':'monospace','sans':'sans-serif'};
      const styles=read('cfg.css').replace(/var\(--([\w-]+)\)/g,(_,key)=>colors[key]||'#24342d');
      const css=d.createElementNS('http://www.w3.org/2000/svg','style');css.textContent=styles;svg.prepend(css);
      writeFileSync(`${process.env.CFG_EXPORT_DIR}/${ex.id}-m${r.index}.svg`,new w.XMLSerializer().serializeToString(svg).replaceAll('context-stroke','#376c48'));
    }
  }
}
click('[data-example="2"]');
assert.match(d.querySelector('.cfg-svg').textContent,/y ← x \+ 1/);
assert.match(d.querySelector('.cfg-svg').textContent,/cmp1 ← y > 20/);
assert.match(d.getElementById('source').textContent,/add.i32/);
assert.match(d.getElementById('source').textContent,/cmp.u32/);
click('[data-source="c"]');assert.match(d.getElementById('source').textContent,/int main/);
click('[data-source="llvm"]');assert.match(d.getElementById('source').textContent,/define/);
click('[data-source="svf"]');assert.ok(d.querySelector('[data-svf-block]'));
click('[data-example="0"]');
w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
assert.match(d.getElementById('state-badge').textContent,/CANDIDATE/);
assert.ok(d.querySelector('.cfg-edge.candidate'));
assert.ok(d.querySelector('.svf-source-block.active'),'Candidate playback highlights mapped SVF blocks');
click('#view-tla');assert.match(d.querySelector('.tla-code').textContent,/VARIABLES pc/);
click('[data-model-round="1"]');assert.match(d.querySelector('.tla-code').textContent,/VARIABLES pc, p0/);
assert.ok(d.querySelector('.tla-line.changed'));
assert.match(d.querySelector('.tla-status').textContent,/TLC has not been run/);
assert.ok(d.querySelector('[download$=".tla"]').href.startsWith('data:text/plain'));
click('[data-svf-block]');assert.ok(d.querySelector('.tla-code'),'Source selection preserves model view');
click('[data-example="4"]');assert.ok(d.getElementById('view-tla').disabled);assert.equal(d.querySelectorAll('.tla-code').length,0);
click('[data-example="0"]');click('#view-cfg');assert.ok(d.querySelector('.cfg-svg'));
assert.equal(errors.length,0,errors.map(String).join('\n'));
console.log(`CFG checks passed: ${snapshots} snapshots, two-way SVF/CFG mapping, primary SVF source and reference tabs, fixed geometry, reachable facts, recorded transition filtering, keyboard playback, and archive links.`);
w.close();
