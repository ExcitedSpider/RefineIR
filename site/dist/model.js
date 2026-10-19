(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config=null,compare=false,selected=null,lastExample=null;
function stateKey(node,valuation) {return `${node}:${valuation}`;}
function negate(text) {
  const replacements=[[' ≥ ',' < '],[' ≤ ',' > '],[' > ',' ≤ '],[' < ',' ≥ '],[' == ',' != '],[' != ',' == ']];
  if(!text.startsWith('not ')&&!text.includes('(')) for(const [a,b] of replacements) if(text.includes(a))return text.replace(a,b);
  return `¬(${text})`;
}
function facts(round,mask) {return round.predicates.map((p,i)=>mask&(1<<i)?config.friendly(p):negate(config.friendly(p)));}
function short(text,limit=23) {return text.length>limit?text.slice(0,limit-1)+'…':text;}
function graph(ex) {
  const all=$('model-all-nodes').checked;
  const outgoing=new Map(ex.nodes.map(n=>[n.id,ex.edges.filter(e=>e.from===n.id)]));
  const keep=new Set(ex.nodes.filter(n=>all||(['entry','exit','error'].includes(n.kind))||outgoing.get(n.id).some(e=>e.label)||n.statements.some(s=>s.startsWith('BinaryOPStmt'))).map(n=>n.id));
  const edges=[];
  for(const n of ex.nodes.filter(n=>keep.has(n.id)&&n.kind!=='error')) {
    function walk(edge,ids,seen) {
      if(seen.has(edge.to))return;
      const path=[...ids,edge.id];
      if(keep.has(edge.to))edges.push({from:n.id,to:edge.to,ids:path,label:ex.edges[path[0]].label});
      else for(const next of outgoing.get(edge.to)||[])walk(next,path,new Set([...seen,edge.to]));
    }
    for(const e of outgoing.get(n.id))walk(e,[],new Set([n.id]));
  }
  const nodes=ex.nodes.filter(n=>keep.has(n.id));
  // Stable topological rows are shared by every iteration and comparison panel.
  const degree=new Map(nodes.map(n=>[n.id,edges.filter(e=>e.to===n.id).length]));
  const remaining=new Set(nodes.map(n=>n.id)),ordered=[];
  while(remaining.size) {
    const ready=nodes.filter(n=>remaining.has(n.id)&&degree.get(n.id)===0)
      .sort((a,b)=>(a.kind==='exit')-(b.kind==='exit')||(a.line||0)-(b.line||0)||a.id-b.id);
    if(!ready.length)throw new Error('Expected acyclic presentation graph');
    const n=ready[0];ordered.push(n);remaining.delete(n.id);
    for(const e of edges.filter(e=>e.from===n.id))degree.set(e.to,degree.get(e.to)-1);
  }
  return {nodes:ordered,edges,outgoing};
}
function locationName(n,g) {
  const ex=config.example;
  if(n.kind==='entry')return 'main()';
  if(n.kind==='exit')return 'return';
  if(n.kind==='error')return 'ERROR()';
  const guard=g.outgoing.get(n.id).find(e=>e.label==='true');
  if(guard) {
    const condition=ex.source.split('\n')[n.line-1]?.match(/\bif\s*\(([^()]*)\)/)?.[1];
    return `if ${condition||config.friendly(guard.formula)}`;
  }
  const input=ex.inputs.find(i=>i.node===n.id);
  if(input)return `${config.friendly(input.name)} = nondet()`;
  const line=ex.source.split('\n')[n.line-1]?.trim();
  return line?.replace(/;$/, '').replace(/^(?:unsigned|int|long|short|bool)\s+/, '')||'Program step';
}
function stats(r) {
  const errors=new Set(config.example.nodes.filter(n=>n.kind==='error').map(n=>n.id));
  return {states:r.explored.length,transitions:r.transitions.length,errors:r.explored.filter(s=>errors.has(s.node)).length};
}
function modelSvg(roundIndex,g) {
  const ex=config.example,r=ex.rounds[roundIndex];
  const masks=[...new Set(r.initialStates.map(s=>s.valuation))].sort((a,b)=>a-b);
  const reached=new Set(r.explored.map(s=>stateKey(s.node,s.valuation)));
  const allowed=new Set(r.transitions.map(t=>`${t.edge}:${t.valuation}`));
  const rejected=new Set(r.blocked.map(t=>`${t.edge}:${t.valuation}`));
  const path=new Set(r.path||[]),candidateNodes=new Set();
  for(const id of path) {candidateNodes.add(ex.edges[id].from);candidateNodes.add(ex.edges[id].to);}
  const width=60+masks.length*210,top=Math.max(88,48+Math.min(4,r.predicates.length)*19),rowHeight=58,height=top+g.nodes.length*rowHeight+10;
  const ys=new Map(g.nodes.map((n,i)=>[n.id,top+i*rowHeight+22]));
  const idPrefix=`model-${roundIndex}`;
  let svg=`<svg class="abstract-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Reachable abstract model M${roundIndex}, ${r.predicates.length} predicates, ${r.explored.length} states, ${stats(r).errors} reachable error states"><title>Abstract model M${roundIndex}</title><desc>Columns separate predicate valuations. Rows show program locations. Solid arrows are recorded abstract transitions. Dashed arrows are rejected transition attempts.</desc><defs><marker id="${idPrefix}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#a0b399"/></marker><marker id="${idPrefix}-path" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#376c48"/></marker></defs>`;
  svg+=`<text class="model-axis" x="8" y="27">SOURCE</text>`;
  masks.forEach((m,column)=>{
    const x=60+column*210;
    svg+=`<rect class="valuation-lane" x="${x}" y="8" width="202" height="${height-16}" rx="7"/><text class="valuation-title" x="${x+101}" y="29" text-anchor="middle">${r.predicates.length?'INPUTS SATISFYING':'NO DISTINCTIONS YET'}</text>`;
    const labels=facts(r,m);
    if(!labels.length)labels.push('All input values');
    labels.slice(0,3).forEach((label,i)=>{svg+=`<text class="valuation-fact" x="${x+101}" y="${53+i*19}" text-anchor="middle"><title>${esc(label)}</title>${esc(short(label,25))}</text>`;});
    if(r.predicates.length>3)svg+=`<text class="valuation-fact" x="${x+101}" y="110" text-anchor="middle">+ ${r.predicates.length-3} predicates</text>`;
  });
  for(const n of g.nodes) {
    const y=ys.get(n.id),name=locationName(n,g);
    svg+=`<line class="model-row-guide" x1="8" x2="${width-10}" y1="${y+28}" y2="${y+28}"/><text class="model-source-line" x="10" y="${y+4}"><title>${esc(name)}${n.line?` · source line ${n.line}`:''}</title>${n.line?`L${n.line}`:n.kind==='entry'?'entry':n.kind==='exit'?'exit':'—'}</text>`;
  }
  for(const [column,m] of masks.entries()) {
    const x=161+column*210;
    for(const [edgeIndex,e] of g.edges.entries()) {
      const ok=e.ids.every(id=>allowed.has(`${id}:${m}`));
      const cut=reached.has(stateKey(e.from,m))&&e.ids.some(id=>rejected.has(`${id}:${m}`));
      if(!ok&&!(cut&&$('model-rejected').checked))continue;
      const a=ys.get(e.from),b=ys.get(e.to),onPath=ok&&m===r.pathValuation&&e.ids.every(id=>path.has(id));
      const rail=x+87+(edgeIndex%3)*6;
      const d=b-a>rowHeight+1?`M${x+79},${a} Q${rail},${a} ${rail},${a+20} L${rail},${b-20} Q${rail},${b} ${x+80},${b}`:`M${x},${a+20} L${x},${b-21}`;
      const guard=e.ids.map(id=>ex.edges[id]).find(e=>e.label);
      svg+=`<path class="model-transition ${onPath?'candidate':''} ${cut?'rejected':''}" data-model-transition="${roundIndex}:${m}:${e.ids.join(',')}" d="${d}" ${ok?`marker-end="url(#${idPrefix}-${onPath?'path':'arrow'})"`:''}><title>${esc(cut?`Rejected under ${facts(r,m).join(' ∧ ')}: ${guard?config.friendly(guard.formula):'inconsistent guard'}`:guard?config.friendly(guard.formula):'Unconditional transition')}</title></path>`;
      if(cut)svg+=`<text class="model-cut-label" x="${b-a>rowHeight+1?rail-4:x+6}" y="${a+31}">×</text>`;
      else if(e.label)svg+=`<text class="model-edge-label" x="${b-a>rowHeight+1?rail-30:x+7}" y="${a+30}">${esc(e.label)}</text>`;
    }
    for(const n of g.nodes) {
      const y=ys.get(n.id),exists=reached.has(stateKey(n.id,m)),onPath=exists&&m===r.pathValuation&&candidateNodes.has(n.id);
      if(!exists) {
        svg+=`<g class="abstract-ghost" aria-label="${esc(locationName(n,g))}, ${esc(facts(r,m).join(' and ')||'all inputs')}: not reachable"><rect x="${x-80}" y="${y-20}" width="160" height="40" rx="5"/><text x="${x}" y="${y+4}" text-anchor="middle">${n.kind==='error'?'ERROR unreachable':'not reachable'}</text></g>`;
        continue;
      }
      const key=`${roundIndex}:${n.id}:${m}`,isSelected=selected===key;
      const name=locationName(n,g),remembered=facts(r,m).join(' ∧ ')||'all inputs';
      svg+=`<g class="abstract-state ${n.kind==='error'?'error':''} ${onPath?'on-path':''} ${isSelected?'selected':''}" data-abstract-state="${key}" tabindex="0" role="button" aria-label="Model ${roundIndex}, ${esc(name)}, ${esc(remembered)}${onPath?', candidate path':''}"><title>${esc(name)} — ${esc(remembered)}</title><rect x="${x-80}" y="${y-20}" width="160" height="40" rx="5"/><text class="state-location" x="${x}" y="${y-4}" text-anchor="middle">${esc(short(name,18))}</text><text class="state-facts" x="${x}" y="${y+12}" text-anchor="middle">${esc(short(remembered,21))}</text></g>`;
    }
  }
  return svg+'</svg>';
}
function selectState(key) {
  selected=key;const [roundIndex,nodeId,mask]=key.split(':').map(Number),ex=config.example,r=ex.rounds[roundIndex],n=ex.nodes.find(n=>n.id===nodeId);
  const stateFacts=facts(r,mask),out=r.transitions.filter(t=>t.from===nodeId&&t.valuation===mask),blocked=r.blocked.filter(t=>ex.edges[t.edge].from===nodeId&&t.valuation===mask);
  $('model-state-detail').innerHTML=`<div><span class="eyebrow">SELECTED ABSTRACT STATE · M${roundIndex}${n.line?` · LINE ${n.line}`:''}</span><h3>${esc(locationName(n,graph(ex)))}</h3><p>${stateFacts.length?stateFacts.map(f=>`<code>${esc(f)}</code>`).join(' ∧ '):'⊤ — all input values are grouped together.'}</p></div><div><p>${n.kind==='error'?'A reachable abstract error state. Consult the path check to determine whether it is real.':`${out.length} permitted outgoing transition${out.length===1?'':'s'}; ${blocked.length} rejected.`}</p>${blocked.map(b=>`<p class="rejected-detail">× ${esc(config.friendly(ex.edges[b.edge].formula))} conflicts with these facts.</p>`).join('')}</div>`;
  document.querySelectorAll('[data-abstract-state]').forEach(el=>el.classList.toggle('selected',el.dataset.abstractState===key));
  config.onSelectState(nodeId,roundIndex,mask);
}
function render() {
  const ex=config.example,index=config.roundIndex,r=ex.rounds[index];
  if(!r?.modelComplete) {
    $('model-rounds').innerHTML='';$('model-change').textContent='No abstract model was built for this unsupported program.';
    $('model-canvases').innerHTML='<div class="boundary">The engine stopped before reachability. No model snapshot is available.</div>';
    $('model-compare').disabled=true;$('model-single').disabled=true;
    $('model-state-detail').textContent='No abstract states to inspect.';return;
  }
  $('model-single').disabled=false;$('model-compare').disabled=index===0;
  const comparing=compare&&index>0;
  $('model-single').setAttribute('aria-pressed',String(!comparing));$('model-compare').setAttribute('aria-pressed',String(comparing));
  $('model-rounds').innerHTML=ex.rounds.map((round,i)=>{
    const s=stats(round);
    return `<button data-model-round="${i}" aria-pressed="${i===index}"><span class="model-round-id">M${i} <span>ROUND ${i}</span></span><strong>${round.predicates.length} predicate${round.predicates.length===1?'':'s'}</strong><span>${s.states} states · ${s.errors} abstract error${s.errors===1?'':'s'}</span></button>`;
  }).join('');
  $('model-rounds').querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=null;config.onSelectRound(Number(b.dataset.modelRound));});
  const s=stats(r);
  if(index===0) $('model-change').innerHTML='<strong>M0: one undivided input space.</strong> With no predicates, individually feasible branches can form an impossible path.';
  else {
    const before=stats(ex.rounds[index-1]),learned=ex.rounds[index-1].learnedPredicates?.join('; ');
    $('model-change').innerHTML=`<strong>M${index-1} → M${index}</strong> Learned <code>${esc(config.friendly(learned||r.predicates.at(-1)))}</code>. <span>${before.states} → ${s.states} reachable states; ${before.errors} → ${s.errors} abstract error states.</span> Refinement can add states while removing impossible paths.`;
  }
  const g=graph(ex),indices=comparing?[index-1,index]:[index];
  $('model-canvases').classList.toggle('comparing',comparing);
  $('model-canvases').style.setProperty('--model-columns',indices.map(i=>`${60+new Set(ex.rounds[i].initialStates.map(s=>s.valuation)).size*210}fr`).join(' '));
  $('model-canvases').classList.toggle('all-detail',$('model-all-nodes').checked);
  $('model-canvases').innerHTML=indices.map(i=>{
    const round=ex.rounds[i],counts=stats(round),p=round.predicates;
    return `<article class="model-panel" data-model-panel="${i}"><div class="model-panel-heading"><h3>M${i} <span>${comparing?(i===index?'AFTER':'BEFORE'):'CURRENT MODEL'}</span></h3><span class="model-error-count ${counts.errors?'has-errors':''}">${counts.errors?`${counts.errors} abstract error${counts.errors===1?'':'s'}`:'ERROR unreachable'}</span></div><div class="model-precision">${p.length?p.map((pred,k)=>`<span><b>p${k}</b> ≡ ${esc(config.friendly(pred))}</span>`).join(''):'Precision ∅ · all concrete input values share one abstract valuation'}</div><div class="model-scroll" tabindex="0" role="region" aria-label="Scrollable abstract model M${i}">${modelSvg(i,g)}</div><div class="model-panel-caption">${counts.states} reachable states · ${counts.transitions} transitions before straight-line steps are collapsed. ${$('model-all-nodes').checked?'All program locations shown.':'Straight-line locations collapsed.'} Select a state to highlight its source. ERROR states are terminal.</div></article>`;
  }).join('');
  document.querySelectorAll('[data-abstract-state]').forEach(el=>{
    el.onclick=()=>selectState(el.dataset.abstractState);
    el.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectState(el.dataset.abstractState);}};
  });
  $('model-state-detail').textContent='Select a state to inspect its predicate values and outgoing transitions.';
  // Keep comparison panels vertically aligned while allowing independent horizontal scrolling.
  const scrollers=[...$('model-canvases').querySelectorAll('.model-scroll')];
  scrollers.forEach(el=>el.onscroll=()=>{for(const other of scrollers)if(other!==el&&other.scrollTop!==el.scrollTop)other.scrollTop=el.scrollTop;});
}
$('model-single').onclick=()=>{compare=false;selected=null;render();};
$('model-compare').onclick=()=>{compare=true;selected=null;render();};
$('model-rejected').onchange=render;$('model-all-nodes').onchange=render;
window.CEGAR_MODEL={render(next){config=next;if(lastExample!==next.example.id){compare=false;selected=null;lastExample=next.example.id;}render();}};
})();
