import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportModels } from './export-tla.mjs';
const root=resolve(import.meta.dirname,'..'),dist=`${root}/site/dist`;
const read=p=>readFileSync(`${dist}/${p}`,'utf8');
const original=read('state-columns.html');
const cfg=original.replace('<body>','<body class="cfg-version">')
  .replace(/<header class="topbar">.*?<\/header>/,'<header class="topbar compact-header"><a class="brand" href="#"><span class="brand-icon">↳</span> THE REFINEMENT LAB</a><h1>A program. A model. <em>One refinement.</em></h1><span class="header-stack">SVF → predicate abstraction → Z3</span><nav class="header-links" aria-label="Project links"><a href="https://github.com/ExcitedSpider/RefineIR" target="_blank" rel="noopener noreferrer" class="quiet-link">GitHub ↗</a><a href="#under-the-hood" class="quiet-link">How it works ↗</a></nav></header>')
  .replace(/\s*<section class="intro">.*?<\/section>/,'')
  .replace('<link rel="stylesheet" href="style.css">','<link rel="stylesheet" href="style.css"><link rel="stylesheet" href="cfg.css">')
  .replace('<script defer src="model.js"></script>','<script defer src="model.js"></script><script defer src="cfg.js"></script><script defer src="tla.js"></script>')
  .replace('<button id="model-single"','<button id="view-cfg" aria-pressed="true">CFG</button><button id="view-tla" aria-pressed="false">TLA+ model</button><button id="model-single"')
  .replace('href="index.html" data-presentation','href="state-columns.html" data-presentation')
  .replace('Return to SVF CFG ↗','Archived state-column view ↗')
  .replace('THE ABSTRACT MODEL','CFG WITH SVF OPERATIONS')
  .replace('<h3>THE PROGRAM</h3>','<h3>THE PROGRAM · SVF IR</h3>')
  .replace('<button class="active" data-source="c">C source</button><button data-source="llvm">LLVM IR</button>','<button class="active" data-source="svf">SVF program</button><button data-source="c">C reference</button><button data-source="llvm">LLVM reference</button>')
  .replace('Rows: source lines · columns: remembered facts','Blocks: SVF operations · arrows: selected facts')
  .replace('<i class="legend-line path"></i> Candidate','<i class="legend-line path"></i> Candidate');
writeFileSync(`${dist}/cfg.html`,cfg);
writeFileSync(`${dist}/index.html`,cfg);
function portable(source,alternate=false) {
let html=source
  .replace('<link rel="stylesheet" href="style.css">',()=>`<style>${read('style.css')}</style>`)
  .replace('<script defer src="data/results.js"></script>','')
  .replace('<script defer src="model.js"></script>','')
  .replace('<script defer src="app.js"></script>','')
  .replace('<script defer src="reload.js"></script>','')
  .replace('<script defer src="cfg.js"></script>','')
  .replace('<script defer src="tla.js"></script>','')
  .replace('<link rel="stylesheet" href="cfg.css">',()=>`<style>${read('cfg.css')}</style>`)
  .replace('</body>',()=>`<script>${read('data/results.js').replaceAll('</script','<\\/script')}</script><script>${read('model.js').replaceAll('</script','<\\/script')}</script>${alternate?`<script>${read('cfg.js').replaceAll('</script','<\\/script')}</script><script>${read('tla.js').replaceAll('</script','<\\/script')}</script>`:''}<script>${read('app.js').replaceAll('</script','<\\/script')}</script></body>`);
// The evidence links also work in the portable single-file edition.
const results=read('data/results.json');
html=html.replace('href="data/results.json"',`href="data:application/json;charset=utf-8,${encodeURIComponent(results)}"`);
html=html.replace('href="state-columns.html" data-presentation','href="refinement-lab-state-columns.html" data-presentation').replace('href="index.html" data-presentation','href="refinement-lab.html" data-presentation');
return html;
}
writeFileSync(`${root}/refinement-lab.html`,portable(cfg,true));
writeFileSync(`${root}/refinement-lab-state-columns.html`,portable(original));
writeFileSync(`${root}/refinement-lab-cfg.html`,portable(cfg,true));
console.log('Published SVF CFG as the default LAN/offline view; preserved the archived state-column view and cfg.html alias.');
console.log(`Exported ${exportModels().length} TLA+ models with TLC configurations.`);
