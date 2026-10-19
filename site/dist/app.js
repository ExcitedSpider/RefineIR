(() => {
'use strict';
const data = window.CEGAR_RESULTS;
const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaultSourceMode=window.CEGAR_SVF?'svf':'c';
let exampleIndex = 0, stepIndex = 0, sourceMode = defaultSourceMode, selectedNode = null;
const names = ['False alarm', 'Real bug', 'Arithmetic', 'Two refinements', 'x > y', 'The boundary'];
function current() { return data.examples[exampleIndex]; }
function inputNames(ex) {
  return Object.fromEntries((ex.inputs || []).map(input => {
    const n = ex.nodes.find(n => n.id === input.node);
    const line = ex.source.split('\n')[n.line - 1] || '';
    return [input.name, line.match(/\b(\w+)\s*=\s*nondet_/)?.[1] || input.name];
  }));
}
function friendly(text, ex = current()) {
  const map = inputNames(ex);
  return String(text).replace(/input_\d+/g, x => map[x] || x).replaceAll(' >u ', ' > ').replaceAll(' <u ', ' < ').replaceAll(' >=u ', ' ≥ ').replaceAll(' <=u ', ' ≤ ').replaceAll(' <= ', ' ≤ ').replaceAll(' >= ', ' ≥ ');
}
function programStep(n, ex = current()) {
  if(n.kind==='entry')return 'Enter main()';
  if(n.kind==='exit')return 'Return from main()';
  if(n.kind==='error')return 'ERROR()';
  const line=ex.source.split('\n')[n.line-1]?.trim()||'';
  const branch=ex.edges.find(e=>e.from===n.id&&e.label==='true');
  if(branch)return line.match(/\bif\s*\(([^()]*)\)/)?.[0]||`if ${friendly(branch.formula,ex)}`;
  return line.replace(/^(unsigned|int) /,'').replace(/;$/,'')||'Continue execution';
}
function frames(ex) {
  if (ex.verdict === 'UNKNOWN') return [{type:'unknown', round:0}];
  const out = [];
  ex.rounds.forEach((r, i) => {
    if (r.outcome === 'safe') out.push({type:'safe', round:i});
    else {
      out.push({type:'explore',round:i},{type:'candidate',round:i},{type:r.outcome,round:i});
      if (r.learned) out.push({type:'refine',round:i});
    }
  });
  return out;
}
function currentFrame() { return frames(current())[stepIndex]; }
function renderTabs() {
  const vertical=Boolean(window.CEGAR_SVF)&&(!window.matchMedia||window.matchMedia('(min-width:901px)').matches);
  $('examples').setAttribute('aria-orientation',vertical?'vertical':'horizontal');
  $('examples').innerHTML = data.examples.map((e,i) => `<button role="tab" id="example-${i}" aria-selected="${i===exampleIndex}" tabindex="${i===exampleIndex?0:-1}" data-example="${i}"><span class="tab-num">0${i+1}</span>${names[i]}</button>`).join('');
  $('examples').querySelectorAll('button').forEach(b => {
    b.onclick = () => chooseExample(Number(b.dataset.example));
    b.onkeydown = event => {
      if (!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const n = data.examples.length;
      chooseExample(event.key==='Home'?0:event.key==='End'?n-1:(exampleIndex+(['ArrowRight','ArrowDown'].includes(event.key)?1:n-1))%n);
      $(`example-${exampleIndex}`).focus();
    };
  });
}
function chooseExample(index) {
  exampleIndex=index; stepIndex=0; selectedNode=null; sourceMode=defaultSourceMode;
  $('node-inspector').open=false;
  $('node-title').textContent='Inspect a program step';
  $('node-detail').textContent='Select a statement to see its source and possible next steps.';
  render();
}
window.matchMedia?.('(min-width:901px)').addEventListener?.('change',()=>renderTabs());
function renderSource() {
  const ex=current(), frame=currentFrame(), round=ex.rounds[frame.round];
  const path=['candidate','sat','unsat'].includes(frame.type)?round?.path||[]:[];
  const highlighted=new Set();
  for(const i of path) {
    const edge=ex.edges[i];
    for(const id of [edge.from,edge.to]) highlighted.add(ex.nodes.find(n=>n.id===id)?.line);
  }
  if(selectedNode!==null) { highlighted.clear(); highlighted.add(ex.nodes.find(n=>n.id===selectedNode)?.line); }
  $('source').classList.toggle('svf-listing',sourceMode==='svf');
  if(sourceMode==='svf')window.CEGAR_SVF.renderListing(ex,{selectedNode,path});
  else {
  const text=sourceMode==='c'?ex.source:ex.llvm;
  $('source').innerHTML=text.trimEnd().split('\n').map((line,i)=>{
    const content=sourceMode==='c'?esc(line).replace(/\b(extern|int|unsigned|void|if|return|while)\b/g,'<span class="tok-keyword">$1</span>').replace(/\b(ERROR|nondet_int|nondet_uint)\b/g,'<span class="tok-call">$1</span>').replace(/\b(\d+)\b/g,'<span class="tok-number">$1</span>'):esc(line);
    return `<span class="code-line ${sourceMode==='c'&&highlighted.has(i+1)?'active':''}"><span class="line-no">${i+1}</span>${content}</span>`;
  }).join('');
  }
  document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('active',b.dataset.source===sourceMode);b.setAttribute('aria-pressed',b.dataset.source===sourceMode);});
  $('file-name').textContent=`${ex.id}.${sourceMode==='svf'?'svfir':sourceMode==='c'?'c':'ll'}`;
  $('input-note').textContent=sourceMode==='svf'?'Readable SVF · s32 signed, u32 unsigned. Blocks match the graph; debug metadata and pass-through steps are omitted.':ex.id==='arithmetic'?'Unsigned 32-bit inputs; addition wraps modulo 2³².':'Nondeterministic inputs range over all signed 32-bit integers.';
}
function compactGraph(ex) {
  const outgoing=new Map(ex.nodes.map(n=>[n.id,ex.edges.filter(e=>e.from===n.id)]));
  const keep=new Set(ex.nodes.filter(n=>n.kind!=='instruction'||outgoing.get(n.id).some(e=>e.label)||n.statements.some(s=>s.startsWith('BinaryOPStmt'))).map(n=>n.id));
  const edges=[];
  for(const n of ex.nodes.filter(n=>keep.has(n.id)&&n.kind!=='error')) {
    function walk(edge,ids,seen) {
      if(seen.has(edge.to)) return;
      const path=[...ids,edge.id];
      if(keep.has(edge.to)) edges.push({from:n.id,to:edge.to,ids:path,label:ex.edges[path[0]].label});
      else for(const next of outgoing.get(edge.to)||[]) walk(next,path,new Set([...seen,edge.to]));
    }
    for(const e of outgoing.get(n.id)) walk(e,[],new Set([n.id]));
  }
  const nodes=ex.nodes.filter(n=>keep.has(n.id)).map(n=>({...n}));
  const ranks=new Map(nodes.map(n=>[n.id,0]));
  for(let i=0;i<nodes.length;i++) for(const e of edges) ranks.set(e.to,Math.max(ranks.get(e.to),ranks.get(e.from)+1));
  const groups=new Map();
  for(const n of nodes) {const rank=ranks.get(n.id); if(!groups.has(rank)) groups.set(rank,[]);groups.get(rank).push(n);}
  for(const [rank,group] of groups) group.forEach((n,i)=>{
    n.gx=group.length===1?230:(i+1)*460/(group.length+1);
    n.gy=42+rank*86;
  });
  return {nodes,edges,height:Math.max(...nodes.map(n=>n.gy))+55,outgoing};
}
function renderGraph() {
  const ex=current(),frame=currentFrame();
  if(!ex.nodes) { $('graph').innerHTML='<div class="boundary"><strong>A boundary, not a verdict.</strong>This example contains a loop and a value-merging phi instruction. The checker stops before abstract exploration.<br><br>No proof of safety or bug is claimed.</div>';return; }
  const graph=compactGraph(ex), round=ex.rounds[frame.type==='refine'?Math.min(frame.round+1,ex.rounds.length-1):frame.round];
  const candidate=['candidate','sat','unsat'].includes(frame.type)?ex.rounds[frame.round].path||[]:[];
  const pathSet=new Set(candidate), pathNodes=new Set();
  for(const id of candidate) {pathNodes.add(ex.edges[id].from);pathNodes.add(ex.edges[id].to);}
  function blocked(id) {
    if(frame.type==='explore' || frame.type==='candidate') return false;
    const valuations=round.explored.filter(s=>s.node===ex.edges[id].from).map(s=>s.valuation);
    return valuations.length>0&&valuations.every(v=>round.blocked.some(b=>b.edge===id&&b.valuation===v));
  }
  let svg=`<svg viewBox="0 0 460 ${graph.height}" role="img" aria-label="Program control flow. Select a statement to inspect its source."><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#aab8a6"/></marker><marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#376c48"/></marker></defs>`;
  for(const e of graph.edges) {
    const a=graph.nodes.find(n=>n.id===e.from),b=graph.nodes.find(n=>n.id===e.to);
    const onPath=e.ids.every(id=>pathSet.has(id)),cut=e.ids.some(blocked);
    let d,labelX,labelY;
    if(b.gy-a.gy>100) {
      const left=b.gx<a.gx,rail=left?25+(graph.edges.indexOf(e)%3)*13:435-(graph.edges.indexOf(e)%3)*13;
      d=`M${a.gx+(left?-75:75)},${a.gy} C${rail},${a.gy} ${rail},${a.gy} ${rail},${a.gy+30} L${rail},${b.gy-30} Q${rail},${b.gy} ${b.gx+(left?-80:80)},${b.gy}`;
      labelX=rail+(left?4:-26);labelY=a.gy+17;
    } else {
      d=`M${a.gx},${a.gy+24} C${a.gx},${a.gy+43} ${b.gx},${b.gy-43} ${b.gx},${b.gy-25}`;
      labelX=(a.gx+b.gx)/2+13;labelY=(a.gy+b.gy)/2+3;
    }
    svg+=`<path class="graph-edge ${onPath?'candidate':''} ${cut?'cut':''}" d="${d}" marker-end="url(#${onPath?'arrow-active':'arrow'})"/><text class="edge-label" x="${labelX}" y="${labelY}">${cut?'× blocked':esc(e.label)}</text>`;
  }
  for(const n of graph.nodes) {
    const branch=graph.outgoing.get(n.id).find(e=>e.label==='true');
    let label=programStep(n,ex);
    if(label.length>25) label=label.slice(0,23)+'…';
    svg+=`<g class="graph-node ${n.kind==='error'?'error':''} ${pathNodes.has(n.id)?'on-path':''} ${selectedNode===n.id?'selected':''}" tabindex="0" role="button" aria-label="Inspect ${esc(programStep(n,ex))}" data-node="${n.id}"><rect x="${n.gx-80}" y="${n.gy-24}" width="160" height="48" rx="${branch?12:5}"/><text x="${n.gx}" y="${n.gy-2}" text-anchor="middle">${esc(label)}</text><text class="node-id" x="${n.gx}" y="${n.gy+13}" text-anchor="middle">${n.line?'source line '+n.line:''}</text></g>`;
  }
  $('graph').innerHTML=svg+'</svg>';
  $('graph').querySelectorAll('[data-node]').forEach(n=>{
    const select=()=>{
      selectedNode=Number(n.dataset.node); const node=ex.nodes.find(n=>n.id===selectedNode);
      $('node-title').textContent=programStep(node,ex);
      const next=graph.edges.filter(e=>e.from===node.id).map(e=>`${e.label?e.label+' → ':''}${programStep(ex.nodes.find(n=>n.id===e.to),ex)}`);
      $('node-detail').textContent=[node.line?`Source line ${node.line}: ${ex.source.split('\n')[node.line-1].trim()}`:programStep(node,ex),...next].join('\n');
      $('node-inspector').open=true; renderGraph();renderSource();
    };
    n.onclick=select;n.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};
  });
}
function renderReasoning() {
  const ex=current(),f=currentFrame(),r=ex.rounds[f.round];
  const content={
    explore:['ABSTRACT MODEL','Begin with less detail.',r?.predicates.length?'The checker now remembers the learned predicates. It searches again for an abstract route to ERROR.':'No predicates are tracked yet. Each branch is checked on its own, so relationships between branches can be forgotten.'],
    candidate:['CANDIDATE PATH','A route to the error.', 'The abstract model reaches ERROR along the highlighted path. That is a question for the solver—not yet evidence of a real bug.'],
    unsat:['Z3 · UNSAT','This path cannot happen.', 'The whole path is inconsistent. No single input can satisfy all its conditions. The alarm came from information the abstraction forgot.'],
    refine:['REFINEMENT','Learn from the UNSAT core.',`Add ${(r?.learnedPredicates||[]).map(p=>'“'+friendly(p)+'”').join(' and ')}. These predicates come from the contradictory constraints, with equivalent or complementary facts merged by Z3.`],
    safe:['SAFE · SUPPORTED MODEL','The false alarm is gone.', 'Complete exploration of the refined model reaches no ERROR. The impossible branch is blocked; the program is safe within the supported semantics.'],
    sat:['Z3 · SAT','This one is a real bug.', 'All path conditions can hold together. Z3 found a concrete input that reaches ERROR; no refinement is needed.'],
    unknown:['UNKNOWN','Stop at the boundary.', ex.reason],
  }[f.type];
  $('state-badge').textContent=content[0];
  $('state-badge').className='state-badge '+(['candidate','unsat','unknown'].includes(f.type)?'alert':f.type==='sat'?'bug':'');
  $('step-title').textContent=content[1];$('step-description').textContent=content[2];
  $('round-label').textContent=r?`ROUND ${f.round}`:'OUT OF SCOPE';
  const preds=[...(r?.predicates||[])];if(f.type==='refine')preds.push(...(r.learnedPredicates||[]));
  $('predicates').innerHTML=preds.length?preds.map(p=>`<div class="predicate">${esc(friendly(p))}</div>`).join(''):'<div class="empty-predicate">∅ &nbsp; No facts remembered</div>';
  let solver='';
  if(['candidate','unsat','sat'].includes(f.type)) {
    const core=new Set((r.core||[]).map(c=>Number(c.replace('edge_',''))));
    solver=`<div class="solver-box"><div class="eyebrow">PATH CONSTRAINTS · ALL MUST HOLD</div>${r.constraints.map((c,i)=>`<div class="constraint ${f.type==='unsat'&&core.has(c.edge)?'core':''}">${i?'∧ ':'  '}${esc(friendly(c.formula))}</div>`).join('')}`;
    if(f.type==='unsat') solver+=`<div class="solver-verdict">UNSAT → spurious counterexample</div><div class="solver-note">Z3's core, minimized by SMT checks: remove any highlighted constraint and the remaining core becomes satisfiable.</div>`;
    if(f.type==='sat') solver+=`<div class="solver-verdict bug">SAT → a feasible error path</div>${r.witness.map(w=>`<div class="witness">${esc(friendly(w.input))} = ${ex.id==='arithmetic'?w.unsigned:w.signed}</div>`).join('')}<div class="solver-note">${ex.replay?.confirmed?'Confirmed by executing the compiled C program with this input.':'A model of the complete encoded path.'}</div>`;
    solver+='</div>';
  } else if(f.type==='refine') solver=`<div class="solver-box"><div class="eyebrow">AFTER LEARNING</div><div class="solver-verdict">${r.pathEliminated?'✓ This candidate path is eliminated':'More refinement is needed'}</div><div class="solver-note">The engine checked the rejected path again under the new predicate valuations.</div></div>`;
  else if(f.type==='safe') solver=`<div class="solver-box"><div class="eyebrow">COMPLETE EXPLORATION</div><div class="solver-verdict">${r.explored.length} abstract states explored</div><div class="solver-note">${r.predicates.length} learned predicate${r.predicates.length===1?'':'s'} · ${ex.solverQueries} solver queries across the run.<br>No loop-unrolling bound was used.</div></div>`;
  else if(f.type==='unknown') solver='<div class="solver-box"><div class="solver-note">UNKNOWN is neither SAFE nor UNSAFE. Adding loop semantics and phi handling is future work.</div></div>';
  const proof=r?.refinement||(f.type==='safe'?ex.rounds[f.round-1]?.refinement:null);
  if(proof&&['unsat','refine','safe'].includes(f.type)) {
    solver+=`<details class="solver-box" ${f.type==='refine'?'open':''}><summary>Why these predicates? · SMT evidence</summary><div class="solver-note">Contradictory core:</div>${proof.core.map(c=>`<div class="constraint core">${esc(friendly(c.formula))}</div>`).join('')}${proof.reductions.map(c=>`<div class="solver-note">${esc(friendly(c.formula))} is ${c.relation==='complement'?'the negation of':'equivalent to'} ${esc(friendly(c.representative))} — proved by Z3.</div>`).join('')}<div class="solver-note">Add ${proof.added.map(c=>esc(friendly(c.formula))).join(' and ')}. Every refined valuation makes a core branch impossible or is itself infeasible.</div>${proof.ignored.length?`<div class="solver-note">Outside the core: ${proof.ignored.map(c=>esc(friendly(c.formula))).join(', ')}.</div>`:''}<a download="${ex.id}-M${f.round}-refinement.json" href="data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(proof,null,2))}">${proof.obligations.length} replayable SMT checks ↓</a><div class="solver-note">Core-guided refinement; no interpolation. A minimal core need not be unique.</div></details>`;
  }
  const queryRound=r?.z3Session?f.round:(f.type==='safe'&&ex.rounds[f.round-1]?.z3Session?f.round-1:null);
  if(queryRound!==null&&['unsat','refine','safe','sat'].includes(f.type)) solver=`<button class="z3-open" data-z3-round="${queryRound}">Z3 input → output · round ${queryRound}</button>`+solver;
  $('solver-content').innerHTML=solver;
  $('solver-content').querySelector('[data-z3-round]')?.addEventListener('click',()=>showZ3(ex,queryRound));
}
function showZ3(ex,index) {
  let dialog=$('z3-dialog');
  if(!dialog) {dialog=document.createElement('dialog');dialog.id='z3-dialog';document.body.append(dialog);}
  const r=ex.rounds[index],core=new Set(r.reportedCore||[]);
  dialog.innerHTML=`<header><div><div class="eyebrow">RECORDED Z3 CALL · ROUND ${index}</div><h2>What the solver received and returned</h2></div><button aria-label="Close Z3 session">Close ×</button></header><p>The checker calls Z3's C++ API. Left: its assertions serialized as replayable SMT-LIB, with tracking assumptions made explicit. Right: the recorded check result and core, before our refiner minimizes it.</p><div class="z3-columns"><section><h3>INPUT · path feasibility</h3><pre class="z3-input">${esc(r.z3Session)}</pre><a download="${ex.id}-M${index}-z3.smt2" href="data:text/plain;charset=utf-8,${encodeURIComponent(r.z3Session)}">Download this SMT-LIB query ↓</a></section><section><h3>OUTPUT · check / unsat_core</h3><pre class="z3-response">${esc(r.z3Response||r.outcome)}</pre><p>${r.outcome==='unsat'?'unsat means no input satisfies all the enabled path conditions. The core names a contradictory subset; it is not a prose explanation or a suggested predicate.':'sat means these conditions can hold together.'}</p><h3>Tracking names → program conditions</h3><div class="z3-core-map">${r.constraints.map(c=>`<div class="${core.has('edge_'+c.edge)?'in-core':''}"><code>edge_${c.edge}</code><span>${esc(friendly(c.formula))}</span><small>${core.has('edge_'+c.edge)?'in returned core':'outside returned core'}</small></div>`).join('')}</div><p><code>input_0</code> = ${esc(friendly('input_0'))}; inputs are 32-bit bit-vectors. <code>bvsle</code> is signed ≤; <code>bvult</code> / <code>bvugt</code> are unsigned comparisons. Tracking names are solver handles, not program locations.</p>${r.refinement?`<div class="z3-followup"><h3>THEN · our refiner</h3><p>Minimize this core, merge equivalent or opposite conditions using SMT checks, and add: <strong>${r.learnedPredicates.map(p=>esc(friendly(p))).join('; ')}</strong>.</p><p>This step is performed by the checker; Z3 does not return these predicates as an instruction.</p></div>`:''}</section></div>`;
  dialog.querySelector('header button').onclick=()=>dialog.close();
  dialog.showModal();
}
function renderControls() {
  const all=frames(current());
  $('previous').disabled=stepIndex===0;$('next').disabled=stepIndex===all.length-1;
  const next=all[stepIndex+1];
  const labels={candidate:'Find a candidate path',unsat:'Check with Z3',sat:'Check with Z3',refine:'Refine the abstraction',explore:'Explore again',safe:'Explore again'};
  $('next').innerHTML=`${next?labels[next.type]:'Walkthrough complete'} <span>${next?'→':'✓'}</span>`;
  $('step-count').textContent=`${stepIndex+1} / ${all.length}`;
  $('timeline').innerHTML=all.map((f,i)=>`<button class="${i===stepIndex?'current':i<stepIndex?'done':''}" aria-label="Step ${i+1}: ${f.type}, round ${f.round}" ${i===stepIndex?'aria-current="step"':''} data-step="${i}"></button>`).join('');
  $('timeline').querySelectorAll('button').forEach(b=>b.onclick=()=>{stepIndex=Number(b.dataset.step);selectedNode=null;render();});
}
function render() {
  const ex=current();renderTabs();
  document.querySelectorAll('[data-presentation]').forEach(link=>{
    const params=new URLSearchParams({example:ex.id,step:String(stepIndex)});
    link.setAttribute('href',link.getAttribute('href').split('?')[0]+'?'+params);
  });
  $('experiment-title').textContent=ex.title;$('experiment-subtitle').textContent=ex.subtitle;
  renderSource();renderGraph();renderReasoning();renderControls();
  $('provenance').textContent=`Engine: ${ex.engine}\nZ3: ${ex.z3Version||'not reached'}\nSVF source commit: ${data.svfCommit}\nRecorded: ${new Date(data.generatedAt).toISOString()}\nResult: ${ex.verdict}\nSemantics: ${data.semantics}\nEvidence: data/${ex.id}.json`;
  $('provenance').style.whiteSpace='pre-wrap';
  $('smt-output').textContent=ex.rounds[currentFrame().round]?.smtlib||'No candidate-path formula in this round.';
  const f=currentFrame();
  window.CEGAR_MODEL.render({
    example:ex,
    roundIndex:f.type==='refine'?Math.min(f.round+1,ex.rounds.length-1):f.round,
    phase:f.type,
    friendly,
    onSelectRound(index) {
      stepIndex=frames(ex).findIndex(frame=>frame.round===index&&frame.type!=='refine');
      selectedNode=null;render();
    },
    onSelectState(nodeId,roundIndex,mask) {
      selectedNode=nodeId;renderSource();
      const displayed=f.type==='refine'?Math.min(f.round+1,ex.rounds.length-1):f.round;
      if(roundIndex===displayed) {
        $('predicates').innerHTML=ex.rounds[roundIndex].predicates.map((p,i)=>`<div class="predicate"><span>p${i} ≡ ${esc(friendly(p))}</span><b class="predicate-value">${mask&(1<<i)?'TRUE':'FALSE'}</b></div>`).join('')||'<div class="empty-predicate">⊤ &nbsp; No facts remembered</div>';
      }
    },
  });
}
$('previous').onclick=()=>{if(stepIndex>0)stepIndex--;selectedNode=null;render();};
$('next').onclick=()=>{if(stepIndex<frames(current()).length-1)stepIndex++;selectedNode=null;render();};
$('previous').setAttribute('aria-keyshortcuts','ArrowLeft');
$('next').setAttribute('aria-keyshortcuts','ArrowRight');
$('previous').title='Previous step (←)';
$('next').title='Next step (→)';
document.addEventListener('keydown',event=>{
  if($('z3-dialog')?.open)return;
  if(event.defaultPrevented||event.isComposing||event.repeat||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
  if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="tablist"],[role="slider"]'))return;
  event.preventDefault();
  const button=$(event.key==='ArrowLeft'?'previous':'next');
  if(!button.disabled)button.click();
});
$('reset').onclick=()=>{stepIndex=0;selectedNode=null;render();};
document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{sourceMode=b.dataset.source;renderSource();});
$('download').onclick=()=>{
  const blob=new Blob([JSON.stringify(current(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=`${current().id}-evidence.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('show-smt').onclick=()=>{$('smt-output').classList.toggle('visible');};
window.addEventListener('cegar:before-reload',()=>{
  try {
    sessionStorage.setItem('cegar-reload-state',JSON.stringify({example:current().id,step:stepIndex,sourceMode,sourceVersion:2,scrollY:window.scrollY}));
  } catch { /* Browsers may disable session storage. Reload still works. */ }
});
let restoredScroll=null;
const viewParams=new URLSearchParams(location.search);
const linkedExample=data.examples.findIndex(ex=>ex.id===viewParams.get('example'));
if(linkedExample>=0) {
  exampleIndex=linkedExample;
  const step=Number(viewParams.get('step'));
  stepIndex=Number.isInteger(step)?Math.max(0,Math.min(step,frames(current()).length-1)):0;
}
try {
  const saved=JSON.parse(sessionStorage.getItem('cegar-reload-state')||'null');
  sessionStorage.removeItem('cegar-reload-state');
  if(saved) {
    const index=data.examples.findIndex(ex=>ex.id===saved.example);
    if(index>=0) {
      exampleIndex=index;
      stepIndex=Number.isInteger(saved.step)?Math.max(0,Math.min(saved.step,frames(current()).length-1)):0;
      sourceMode=saved.sourceVersion===2&&['c','llvm',...(window.CEGAR_SVF?['svf']:[])].includes(saved.sourceMode)?saved.sourceMode:defaultSourceMode;
      restoredScroll=Number.isFinite(saved.scrollY)?saved.scrollY:0;
    }
  }
} catch { /* Ignore stale or unavailable session storage. */ }
render();
if(restoredScroll!==null&&window.requestAnimationFrame)requestAnimationFrame(()=>window.scrollTo(0,restoredScroll));
})();
