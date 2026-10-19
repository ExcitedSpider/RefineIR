(() => {
'use strict';
const ascii=s=>String(s).replaceAll('≤','<=').replaceAll('≥','>=').replaceAll('¬','not ').replaceAll('∧','/\\').replaceAll('∨','\\/');
const quote=s=>JSON.stringify(ascii(s));
function guard(masks,count) {
  if(!masks.length)return 'FALSE';
  if(masks.length===2**count)return 'TRUE';
  let cubes=masks.map(m=>Array.from({length:count},(_,i)=>m&(1<<i)?'1':'0').join(''));
  const primes=new Set();
  while(cubes.length) {
    const used=new Set(),next=new Set();
    for(let a=0;a<cubes.length;a++)for(let b=a+1;b<cubes.length;b++) {
      const diff=[...cubes[a]].flatMap((c,i)=>c!==cubes[b][i]?[i]:[]);
      if(diff.length===1&&cubes[a][diff[0]]!=='-'&&cubes[b][diff[0]]!=='-') {
        used.add(a);used.add(b);next.add([...cubes[a]].map((c,i)=>i===diff[0]?'-':c).join(''));
      }
    }
    cubes.forEach((c,i)=>{if(!used.has(i))primes.add(c);});cubes=[...next];
  }
  return [...primes].map(c=>{
    const terms=[...c].flatMap((bit,i)=>bit==='-'?[]:[bit==='1'?`p${i}`:`~p${i}`]);
    const expr=terms.join(' /\\ ');return terms.length>1?`(${expr})`:expr;
  }).join(' \\/ ');
}
function generate(ex,roundIndex,graph) {
  const r=ex.rounds[roundIndex];if(!r?.modelComplete)return null;
  const module=`${ex.id.replaceAll('-','_')}_M${roundIndex}`;
  const count=r.predicates.length,variables=['pc',...r.predicates.map((_,i)=>`p${i}`)],vars=`<<${variables.join(', ')}>>`;
  const names=new Map(graph.blocks.map(b=>[b.id,ascii(b.label)]));
  if(new Set(names.values()).size!==names.size)throw new Error('TLA export requires unique semantic block labels');
  const allowed=new Set(r.transitions.map(t=>`${t.edge}:${t.valuation}`));
  const initialMasks=[...new Set(r.initialStates.map(s=>s.valuation))].sort((a,b)=>a-b);
  const entry=graph.blocks.find(b=>b.kind==='entry');
  const actions=graph.edges.map(e=>{
    const masks=initialMasks.filter(m=>e.ids.every(id=>allowed.has(`${id}:${m}`)));
    return {from:names.get(e.from),to:names.get(e.to),masks,guard:guard(masks,count),edges:e.ids};
  });
  const errors=graph.blocks.filter(b=>b.kind==='error').map(b=>names.get(b.id));
  const states=graph.blocks.flatMap(b=>r.explored.filter(s=>s.node===b.tail).map(s=>({pc:names.get(b.id),mask:s.valuation})));
  const inputNames=new Map((ex.inputs||[]).map(input=>{
    const node=ex.nodes.find(n=>n.id===input.node),line=ex.source.split('\n')[node.line-1]||'';
    return [input.name,line.match(/\b(\w+)\s*=\s*nondet_/)?.[1]||input.name];
  }));
  const lines=[`---- MODULE ${module} ----`,'EXTENDS TLC','',
    '\\* Recorded abstract model; pc denotes a displayed block end.',
    '\\* Straight-line steps collapsed. Predicates describe immutable inputs.',
    ...r.predicates.map((p,i)=>`\\* p${i} represents: ${ascii(p).replace(/input_\d+/g,name=>inputNames.get(name)||name)}`),'',
    `VARIABLES ${variables.join(', ')}`,`vars == ${vars}`,'',
    'Init ==',`    /\\ pc = ${quote(names.get(entry.id))}`];
  if(count) {
    const tuple=`<<${variables.slice(1).join(', ')}>>`;
    lines.push(`    /\\ ${tuple} \\in {${initialMasks.map(m=>'<<'+r.predicates.map((_,i)=>m&(1<<i)?'TRUE':'FALSE').join(', ')+'>>').join(', ')}}`);
  }
  lines.push('', 'Step(from, to, enabled) ==','    /\\ pc = from','    /\\ enabled',"    /\\ pc' = to");
  if(count)lines.push(`    /\\ UNCHANGED <<${variables.slice(1).join(', ')}>>`);
  lines.push('', 'Next ==');
  actions.forEach(a=>lines.push(`    \\/ Step(${quote(a.from)}, ${quote(a.to)}, ${a.guard})`));
  if(!actions.length)lines.push('    FALSE');
  lines.push('','TypeOK ==',`    /\\ pc \\in {${[...names.values()].map(quote).join(', ')}}`);
  if(count)for(let i=0;i<count;i++)lines.push(`    /\\ p${i} \\in BOOLEAN`);
  lines.push('',`NoError == pc \\notin {${errors.map(quote).join(', ')}}`,'',`Spec == Init /\\ [][Next]_vars`,'====','');
  return {module,source:lines.join('\n'),configuration:'SPECIFICATION Spec\nINVARIANT TypeOK\nINVARIANT NoError\nCHECK_DEADLOCK FALSE\n',actions,states,initialMasks,entry:names.get(entry.id),errors,predicates:r.predicates,expectedSafe:!states.some(s=>errors.includes(s.pc)),tlcChecked:false};
}
window.CEGAR_TLA={generate,guard};
if(!window.document)return;
const $=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const baseRender=window.CEGAR_MODEL.render;
let config,mode='cfg';
function paint() {
  if(!config)return;
  const ex=config.example,r=ex.rounds[config.roundIndex],supported=Boolean(r?.modelComplete);
  $('view-cfg').setAttribute('aria-pressed',String(mode==='cfg'));
  $('view-tla').setAttribute('aria-pressed',String(mode==='tla'));
  $('view-tla').disabled=!supported;
  $('model-lab').classList.toggle('tla-active',mode==='tla'&&supported);
  $('model-lab').querySelector('.pane-heading h3').textContent=mode==='tla'&&supported?'ABSTRACT MODEL · TLA+':'CFG WITH SVF OPERATIONS';
  $('model-lab').querySelector('.model-options p').textContent=mode==='tla'&&supported?'State: pc + predicate Booleans · invariant: NoError':'Blocks: SVF operations · arrows: selected facts';
  if(mode!=='tla'||!supported)return;
  const graph=window.CEGAR_SVF.build(ex),model=generate(ex,config.roundIndex,graph);
  const previous=config.roundIndex?generate(ex,config.roundIndex-1,graph):null;
  const oldLines=new Set(previous?.source.split('\n')||[]);
  const changes=previous?model.actions.filter((a,i)=>a.guard!==previous.actions[i]?.guard):[];
  $('model-canvases').className='model-canvases tla-canvases';
  $('model-canvases').innerHTML=`<article class="tla-panel"><div class="tla-toolbar"><strong>M${config.roundIndex} · executable TLA+</strong><div><a download="${model.module}.tla" href="data:text/plain;charset=utf-8,${encodeURIComponent(model.source)}">Download .tla</a><a download="${model.module}.cfg" href="data:text/plain;charset=utf-8,${encodeURIComponent(model.configuration)}">Download .cfg</a></div></div><div class="tla-summary">${previous?`Added <code>p${model.predicates.length-1}</code>: ${esc(config.friendly(model.predicates.at(-1)))}. ${changes.length} transition guards changed since M${config.roundIndex-1}. Green lines show additions or changes.`:'M0 remembers only the program location. Both individually feasible branches remain possible.'}</div><pre class="tla-code" aria-label="TLA+ model M${config.roundIndex}">${model.source.split('\n').map((line,i)=>`<span class="tla-line ${previous&&!oldLines.has(line)&&line&&!line.startsWith('---- MODULE')?'changed':''}"><span class="tla-line-number" aria-hidden="true">${i+1}</span>${esc(line)}</span>`).join('')}</pre><details class="tla-settings"><summary>TLC configuration & run command</summary><pre>${esc(model.configuration)}\njava -jar tla2tools.jar -config ${model.module}.cfg ${model.module}.tla</pre></details><div class="tla-status">Recorded model: <strong>${model.expectedSafe?'NoError holds':'NoError is violated (abstract counterexample)'}</strong> · ${model.states.length} block states. TLC has not been run. A violation may be spurious; Z3 checks the concrete path.</div></article>`;
  if(previous) document.querySelector('.tla-summary').textContent=`Added ${model.predicates.slice(previous.predicates.length).map((p,i)=>`p${previous.predicates.length+i}: ${config.friendly(p)}`).join('; ')}. ${changes.length} transition guards changed since M${config.roundIndex-1}. Green lines show additions or changes.`;
  window.CEGAR_TLA_CURRENT=model;
}
window.CEGAR_MODEL.render=next=>{config=next;baseRender(next);paint();};
window.addEventListener('cegar:cfg-rendered',paint);
$('view-cfg').onclick=()=>{mode='cfg';baseRender(config);paint();};
$('view-tla').onclick=()=>{mode='tla';paint();};
})();
