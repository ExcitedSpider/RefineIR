(() => {
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const originalRender=window.CEGAR_MODEL.render;
let config,mask=0,lastExample=null,lastRound=-1,chosen=null,inspectBlock=null;
function facts(r,m) {
  return r.predicates.map((p,i)=>{
    const text=config.friendly(p);
    if(m&(1<<i))return text;
    const pairs=[[' ≥ ',' < '],[' ≤ ',' > '],[' > ',' ≤ '],[' < ',' ≥ '],[' == ',' != '],[' != ',' == ']];
    if(!text.includes('(')&&!text.startsWith('not '))for(const [a,b] of pairs)if(text.includes(a))return text.replace(a,b);
    return `¬(${text})`;
  }).join(' ∧ ')||'all inputs';
}

// SVF statement classes come from recorded statements. LLVM annotations supply
// operand spellings, constants and operation names; source supplies debug names.
// Calls/entry/return are explicitly control events, not invented SVF statements.
function operations(ex) {
  const names=new Map();
  for(const n of ex.nodes) {
    const source=ex.source.split('\n')[n.line-1]||'';
    const variable=source.match(/\b(?:unsigned|int)\s+(\w+)\s*=/)?.[1];
    const result=n.raw.match(/(%[\w.]+)\s*=\s*(?:call|add|sub|mul)\b/)?.[1];
    if(variable&&result)names.set(result,variable);
  }
  const name=s=>names.get(s.trim())||s.trim().replace(/^%/,'');
  const out=new Map();
  for(const n of ex.nodes) {
    const rows=[];
    if(n.kind==='input') {
      const call=n.raw.match(/(%[\w.]+)\s*=\s*call\s+i\d+\s+@(\w+)\(/);
      rows.push({kind:'Call',text:call?`${name(call[1])} ← ${call[2]}()`:'nondeterministic input',event:true});
    }
    if(n.kind==='error')rows.push({kind:'Call',text:'ERROR()',event:true});
    for(const s of n.statements) {
      const kind=s.split(':')[0];
      if(kind==='CmpStmt') {
        const m=s.match(/(%[\w.]+)\s*=\s*icmp\s+(\w+)\s+(i\d+)\s+([^,]+),\s*([^,\n]+)/);
        if(m) {
          const operator={eq:'==',ne:'!=',sgt:'>',sge:'≥',slt:'<',sle:'≤',ugt:'>',uge:'≥',ult:'<',ule:'≤'}[m[2]];
          rows.push({kind,text:`${name(m[1])} ← ${name(m[4])} ${operator||m[2]} ${name(m[5])}`,type:`${m[3]} ${m[2].startsWith('u')?'unsigned':m[2].startsWith('s')?'signed':''}`.trim()});
          continue;
        }
      }
      if(kind==='BinaryOPStmt') {
        const m=s.match(/(%[\w.]+)\s*=\s*(\w+)\s+(?:(?:nsw|nuw)\s+)*(i\d+)\s+([^,]+),\s*([^,\n]+)/);
        if(m) {
          const op={add:'+',sub:'−',mul:'×',and:'&',or:'|',xor:'^',shl:'<<',lshr:'>>',ashr:'>>'}[m[2]]||m[2];
          rows.push({kind,text:`${name(m[1])} ← ${name(m[4])} ${op} ${name(m[5])}`,type:m[3]});continue;
        }
      }
      if(kind==='BranchStmt') {
        const condition=s.match(/br i1 (%[\w.]+)/)?.[1];
        rows.push({kind,text:condition?`branch ${name(condition)}`:'continue',type:''});continue;
      }
      if(kind==='PhiStmt'&&n.kind==='exit') {
        const value=s.match(/ret i\d+\s+([^,\n ]+)/)?.[1];
        if(value&&(s.match(/ICFGNode\d+/g)||[]).length===1){rows.push({kind:'Return',text:name(value),type:'i32',event:true,folded:'The single-input function-exit return merge is folded into return.'});continue;}
      }
      // Honest fallback: do not silently invent an operation from the C source.
      rows.push({kind,text:'Select for source context',type:'unformatted operation'});
    }
    if(n.kind==='exit'&&!rows.some(row=>row.kind==='Return'))rows.push({kind:'Return',text:'leave main()',event:true});
    for(const row of rows) {
      const width=row.type?.match(/i(\d+)/)?.[1]||'';
      row.opcode=row.kind==='CmpStmt'?`cmp.${row.type.includes('unsigned')?'u':row.type.includes('signed')?'s':'i'}${width}`:
        row.kind==='BinaryOPStmt'?`binary.i${width}`:row.kind==='BranchStmt'?'branch':row.kind==='Call'?'call':row.kind==='Return'?'return':row.kind;
      if(row.kind==='BinaryOPStmt')row.opcode=(n.raw.match(/=\s*(\w+)\s+(?:(?:nsw|nuw)\s+)*i\d+/)?.[1]||'binary')+'.i'+width;
      if(row.kind==='BranchStmt')row.text=row.text.replace(/^branch /,'');
    }
    out.set(n.id,rows);
  }
  return out;
}
function build(ex) {
  const byId=new Map(ex.nodes.map(n=>[n.id,n])),ops=operations(ex);
  const outgoing=new Map(ex.nodes.map(n=>[n.id,n.kind==='error'?[]:ex.edges.filter(e=>e.from===n.id)]));
  const incoming=new Map(ex.nodes.map(n=>[n.id,ex.edges.filter(e=>e.to===n.id)]));
  const structural=new Set();
  function visit(id){if(structural.has(id))return;structural.add(id);for(const e of outgoing.get(id))visit(e.to);}
  visit(ex.nodes.find(n=>n.kind==='entry').id);
  const leaders=ex.nodes.filter(n=>structural.has(n.id)&&(['entry','exit','error'].includes(n.kind)||n.statements.some(s=>/^(CmpStmt|BinaryOPStmt):/.test(s))));
  const leaderIds=new Set(leaders.map(n=>n.id)),owner=new Map(),blocks=[];
  // Split at comparisons; coalesce only straight-line single-predecessor steps.
  for(const n of leaders) {
    if(owner.has(n.id))continue;
    const members=[n];let tail=n;
    while(!['error','exit'].includes(tail.kind)&&outgoing.get(tail.id).length===1) {
      const next=byId.get(outgoing.get(tail.id)[0].to);
      if(leaderIds.has(next.id)||incoming.get(next.id).length!==1||owner.has(next.id))break;
      members.push(next);tail=next;
    }
    const block={id:n.id,members,tail:tail.id,kind:n.kind,rows:members.flatMap(m=>ops.get(m.id)),line:members.find(m=>m.line)?.line||0};
    for(const m of members)owner.set(m.id,block);
    blocks.push(block);
  }
  const edges=[];
  for(const b of blocks) {
    function walk(e,ids,seen) {
      if(seen.has(e.to))return;
      const path=[...ids,e.id],target=owner.get(e.to);
      if(target){if(target!==b)edges.push({from:b.id,to:target.id,ids:path,label:ex.edges[path[0]].label});return;}
      for(const next of outgoing.get(e.to))walk(next,path,new Set([...seen,e.to]));
    }
    for(const e of outgoing.get(b.tail))walk(e,[],new Set());
  }
  const degree=new Map(blocks.map(b=>[b.id,edges.filter(e=>e.to===b.id).length])),ordered=[],pending=new Set(blocks.map(b=>b.id));
  while(pending.size) {
    const b=blocks.filter(b=>pending.has(b.id)&&degree.get(b.id)===0).sort((a,b)=>(a.line||0)-(b.line||0))[0];
    if(!b)throw new Error('Expected an acyclic CFG');
    pending.delete(b.id);ordered.push(b);for(const e of edges.filter(e=>e.from===b.id))degree.set(e.to,degree.get(e.to)-1);
  }
  for(const b of ordered) {
    const cmp=b.rows.find(row=>row.kind==='CmpStmt'),binary=b.rows.find(row=>row.kind==='BinaryOPStmt');
    b.label=b.kind==='entry'?'entry':b.kind==='exit'?'return':b.kind==='error'?'error':cmp?`test ${cmp.text.split(' ← ')[1]}`:binary?`compute ${binary.text.split(' ← ')[0]}`:'continue';
  }
  for(const b of ordered.filter(b=>b.kind==='error')) {
    const parent=ordered.find(p=>edges.some(e=>e.from===p.id&&e.to===b.id));
    if(parent)b.label=`error after ${parent.label.replace(/^test /,'')}`;
  }
  return {blocks:ordered,edges};
}
function renderListing(ex,{selectedNode,path=[]}) {
  const source=$('source');
  if(!ex.nodes||!ex.rounds.some(r=>r.modelComplete)) {
    source.innerHTML='<span class="svf-unavailable">No mapped SVF listing is available: analysis stopped before building the supported CFG. C and LLVM remain available as references.</span>';return;
  }
  const graph=build(ex),pathNodes=new Set(path.flatMap(id=>[ex.edges[id].from,ex.edges[id].to]));
  source.innerHTML=`<span class="svf-function">function main()</span>`+graph.blocks.map(b=>{
    const active=selectedNode!==null?b.members.some(n=>n.id===selectedNode):b.members.some(n=>pathNodes.has(n.id));
    const edges=graph.edges.filter(e=>e.from===b.id);
    return `<span class="svf-source-block ${active?'active':''}" data-svf-block="${b.id}" tabindex="0" role="button" aria-label="Select ${esc(b.label)} in the CFG"><span class="svf-block-label">${esc(b.label)}</span>${b.rows.map(row=>`<span class="svf-ir-row" title="${esc(row.kind+(row.type?' · '+row.type:'')+(row.folded?' · '+row.folded:''))}"><span class="svf-opcode">${esc(row.opcode)}</span><span class="svf-expression">${esc(row.text)}</span></span>`).join('')}${edges.map(e=>`<span class="svf-target"><span>${e.label||'next'} →</span> ${esc(graph.blocks.find(n=>n.id===e.to).label)}</span>`).join('')}</span>`;
  }).join('');
  source.querySelectorAll('[data-svf-block]').forEach(el=>{
    const select=()=>{
      inspectBlock?.(el.dataset.svfBlock);
      const peer=document.querySelector(`[data-cfg-block="${el.dataset.svfBlock}"]`);
      peer?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    };
    el.onclick=select;
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};
  });
}
window.CEGAR_SVF={build,renderListing};
function renderCfg() {
  const ex=config.example,r=ex.rounds[config.roundIndex];
  if(!r?.modelComplete){window.CEGAR_CFG_SNAPSHOT=null;inspectBlock=null;return;}
  const graph=build(ex),reached=new Set(r.explored.map(s=>`${s.node}:${s.valuation}`));
  const allowed=new Set(r.transitions.map(t=>`${t.edge}:${t.valuation}`));
  const rejected=new Set(r.blocked.map(t=>`${t.edge}:${t.valuation}`));
  const path=new Set(r.path||[]),showPath=['candidate','unsat','sat'].includes(config.phase);
  const masks=[...new Set(r.initialStates.map(s=>s.valuation))].sort((a,b)=>a-b);
  const main=graph.blocks.filter(b=>b.kind!=='error');
  // Error calls sit beside their branch; the main spine and joins remain stable.
  const folded=main.length>=6&&graph.blocks.filter(b=>b.kind==='error').length>1;
  const split=Math.ceil(main.length/2),columnY=[12,12];
  for(const [i,b] of main.entries()) {
    const column=folded&&i>=split?1:0;
    b.x=folded?(column?530:40):60;b.y=columnY[column];b.height=62+b.rows.length*18;b.width=380;
    columnY[column]+=b.height+22;
  }
  for(const b of graph.blocks.filter(b=>b.kind==='error')) {
    const parent=graph.blocks.find(p=>graph.edges.some(e=>e.from===p.id&&e.to===b.id));
    b.x=folded?parent.x:550;b.y=folded?parent.y+parent.height+22:parent?.y||12;b.height=62+b.rows.length*18;b.width=folded?380:330;
    if(folded)for(const next of main.filter(n=>n.x===b.x&&n.y>=b.y))next.y+=b.height+22;
  }
  const height=Math.max(...graph.blocks.map(b=>b.y+b.height))+20;
  let svg=`<svg class="cfg-svg" viewBox="0 0 1000 ${height}" role="img" aria-label="Control-flow graph with SVF operations; following ${esc(facts(r,mask))}"><defs><marker id="cfg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>`;
  for(const [i,e] of graph.edges.entries()) {
    const a=graph.blocks.find(b=>b.id===e.from),b=graph.blocks.find(b=>b.id===e.to);
    const permitted=e.ids.every(id=>allowed.has(`${id}:${mask}`));
    const blocked=reached.has(`${a.tail}:${mask}`)&&e.ids.some(id=>rejected.has(`${id}:${mask}`));
    if(blocked&&!$('model-rejected').checked)continue;
    const candidate=showPath&&mask===r.pathValuation&&e.ids.every(id=>path.has(id));
    const fromY=a.y+a.height/2,toY=b.y+b.height/2;
    let d,lx,ly;
    if(!folded&&b.kind==='error') {d=`M${a.x+a.width},${fromY} L${b.x},${toY}`;lx=490;ly=fromY-9;}
    else if(a.x!==b.x) {const rail=a.x+a.width+25+(i%3)*20;d=`M${a.x+a.width},${fromY} H${rail} V${toY} H${b.x}`;lx=rail+5;ly=fromY-8;}
    else if(b.y===a.y+a.height+22){const center=a.x+a.width/2;d=`M${center},${a.y+a.height} L${center},${b.y}`;lx=center+13;ly=b.y-9;}
    else {const rail=a.x+a.width+18+(i%2)*12,center=b.x+b.width/2;d=`M${a.x+a.width},${fromY} H${rail} V${b.y-12} H${center} V${b.y}`;lx=rail+5;ly=fromY+18;}
    svg+=`<path class="cfg-edge ${permitted?'permitted':'inactive'} ${blocked?'blocked':''} ${candidate?'candidate':''}" data-cfg-edge="${e.ids.join(',')}" data-permitted="${permitted}" d="${d}" marker-end="url(#cfg-arrow)"><title>${esc(blocked?'Rejected for these facts':permitted?'Permitted for these facts':'Not reachable for these facts')}</title></path><text class="cfg-edge-label" x="${lx}" y="${ly}">${esc(e.label)}${blocked?' ×':''}</text>`;
  }
  for(const b of graph.blocks) {
    const live=masks.filter(m=>reached.has(`${b.tail}:${m}`)),active=live.includes(mask);
    const title=b.label;
    const key=String(b.id);
    svg+=`<g class="cfg-block ${active?'reachable':'unreachable'} ${b.kind==='error'?'error':''} ${chosen===key?'selected':''}" data-cfg-block="${b.id}" tabindex="0" role="button" aria-label="${esc(title)}, ${active?'reachable':'unreachable'} for ${esc(facts(r,mask))}"><rect class="cfg-card" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="8"/><text class="cfg-block-heading" x="${b.x+14}" y="${b.y+18}">${esc(title)}</text>`;
    b.rows.forEach((row,i)=>{
      const yy=b.y+36+i*18;
      svg+=`<text class="cfg-op-kind ${row.event?'event':''}" x="${b.x+14}" y="${yy}"><title>${esc(row.kind)}</title>${esc(row.opcode)}</text><text class="cfg-op" x="${b.x+112}" y="${yy}"><title>${esc(row.type||'Control-flow event')}</title>${esc(row.text)}</text>`;
    });
    svg+='</g>';
    if(!live.length)svg+=`<text class="cfg-unreachable" x="${b.x+14}" y="${b.y+b.height-16}">Unreachable in this iteration</text>`;
    else {
      // A compact chip for each reachable valuation. Full facts are always in
      // its accessible label/tooltip and the selection bar above the graph.
      const chipWidth=(b.width-28-(live.length-1)*5)/live.length;
      live.forEach((m,j)=>{
        const xx=b.x+14+j*(chipWidth+5),yy=b.y+b.height-36;
        const label=facts(r,m),lines=label.split(' ∧ ');
        svg+=`<g class="cfg-fact ${m===mask?'active':''}" role="button" tabindex="0" data-cfg-fact="${b.id}:${m}" aria-label="Follow ${esc(label)} at ${esc(title)}"><title>${esc(label)}</title><rect x="${xx}" y="${yy}" width="${chipWidth}" height="30" rx="4"/>${lines.slice(0,2).map((line,k)=>`<text x="${xx+chipWidth/2}" y="${yy+(lines.length===1?19:12+k*12)}" text-anchor="middle">${esc(line)}</text>`).join('')}</g>`;
      });
    }
  }
  svg+='</svg>';
  $('model-canvases').className='model-canvases cfg-canvases';
  $('model-canvases').innerHTML=`<article class="cfg-panel" data-model-panel="${config.roundIndex}"><div class="cfg-toolbar"><strong>M${config.roundIndex} · SVF control flow</strong><span>Same blocks as the SVF listing</span></div><div class="cfg-filters"><span>Follow facts</span>${masks.map(m=>`<button data-cfg-mask="${m}" aria-pressed="${m===mask}">${esc(facts(r,m))}</button>`).join('')}</div><div class="cfg-canvas">${svg}</div><div class="cfg-caption">Select a block here or in the SVF listing. Matching names and operations identify the same block. Chips show reachable facts; arrows follow the selected facts.</div></article>`;
  const bind=(selector,action)=>document.querySelectorAll(selector).forEach(el=>{
    el.onclick=()=>action(el);
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();action(el);}};
  });
  bind('[data-cfg-mask]',el=>{mask=Number(el.dataset.cfgMask);chosen=null;renderCfg();config.onSelectState(graph.blocks.find(b=>b.kind==='entry').tail,config.roundIndex,mask);$('model-state-detail').textContent=`Following ${facts(r,mask)}. Select a block to inspect its SVF operations.`;});
  function inspect(id) {
    const b=graph.blocks.find(b=>b.id===Number(id));chosen=String(id);
    renderCfg();
    const exists=reached.has(`${b.tail}:${mask}`);
    config.onSelectState(b.tail,config.roundIndex,mask);
    $('model-state-detail').innerHTML=`<div class="eyebrow">SELECTED CFG BLOCK</div><h3>${esc(b.label)}</h3><p>${exists?'Reachable':'Unreachable'} for ${esc(facts(r,mask))}</p><div class="cfg-inspect">${b.rows.map(row=>`<p><strong>${esc(row.opcode)}</strong> · ${esc(row.kind)}${row.type?' · '+esc(row.type):''}<br><code>${esc(row.text)}</code>${row.folded?`<br>${esc(row.folded)}`:''}</p>`).join('')}</div><p>The SVF listing and graph share this block. ${b.line?`C reference: line ${b.line}. `:''}Facts describe its end.</p>`;
    $('source').querySelector('.svf-source-block.active')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
  }
  bind('[data-cfg-block]',el=>inspect(el.dataset.cfgBlock));
  bind('[data-cfg-fact]',el=>{const [id,m]=el.dataset.cfgFact.split(':').map(Number);mask=m;inspect(id);});
  inspectBlock=inspect;
  // Expose presentation structure for evidence-based checks, not UI labels.
  window.CEGAR_CFG_SNAPSHOT={graph,mask,roundIndex:config.roundIndex};
  window.dispatchEvent(new Event('cegar:cfg-rendered'));
}
window.CEGAR_MODEL.render=next=>{
  config=next;
  chosen=null;
  if(lastExample!==next.example.id||lastRound!==next.roundIndex) {
    mask=next.example.rounds[next.roundIndex]?.pathValuation??0;chosen=null;
    lastExample=next.example.id;lastRound=next.roundIndex;
  }
  originalRender(next);
  renderCfg();
  $('model-rejected').onchange=renderCfg;
  if(next.example.rounds[next.roundIndex]?.modelComplete)$('model-state-detail').textContent='Select a block to inspect its operations, or choose facts to follow their flow.';
};
})();
