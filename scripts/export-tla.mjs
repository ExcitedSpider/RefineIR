import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const dist=fileURLToPath(new URL('../site/dist/',import.meta.url));
export function exportModels() {
  const context={window:{CEGAR_MODEL:{render(){}}},document:{}};vm.createContext(context);
  vm.runInContext(readFileSync(`${dist}/cfg.js`,'utf8'),context);
  vm.runInContext(readFileSync(`${dist}/tla.js`,'utf8'),context);
  const data=JSON.parse(readFileSync(`${dist}/data/results.json`,'utf8')),manifest=[];
  mkdirSync(`${dist}/models`,{recursive:true});
  for(const ex of data.examples) {
    if(!ex.rounds.some(r=>r.modelComplete))continue;
    const graph=context.window.CEGAR_SVF.build(ex);
    for(const r of ex.rounds) {
      const model=context.window.CEGAR_TLA.generate(ex,r.index,graph);
      writeFileSync(`${dist}/models/${model.module}.tla`,model.source);
      writeFileSync(`${dist}/models/${model.module}.cfg`,model.configuration);
      manifest.push({example:ex.id,round:r.index,...model});
    }
  }
  writeFileSync(`${dist}/models/manifest.json`,JSON.stringify(manifest,null,2));
  return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(`Exported ${exportModels().length} TLA+ models and TLC configurations.`);
