import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
mkdirSync(`${root}/build/screenshots`,{recursive:true});
const browser=spawn('/opt/google/chrome/chrome',['--headless','--no-sandbox','--no-zygote','--single-process','--disable-dev-shm-usage','--disable-gpu','--disable-crashpad-for-testing','--disable-breakpad','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir=/tmp/svf-cegar-browser-qa','about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
let seq=0,buffer='',errors='',session;
const pending=new Map(), pageErrors=[];
browser.stderr.on('data',d=>errors+=d);
browser.on('error',e=>{for(const p of pending.values())p.reject(e);});
browser.on('exit',(code,signal)=>{if(code!==0&&code!==null)console.error(`Chrome exited ${code}: ${errors}`);});
for(const pipe of [browser.stdio[3],browser.stdio[4]])pipe.on('error',e=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(`${e.message}\n${errors}`));}pending.clear();});
browser.stdio[4].on('data',d=>{
  buffer+=d;
  while(buffer.includes('\0')) {
    const i=buffer.indexOf('\0'),s=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!s)continue;
    const msg=JSON.parse(s);
    if(msg.method==='Runtime.exceptionThrown')pageErrors.push(msg.params.exceptionDetails);
    if(pending.has(msg.id)) {const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
  }
});
function send(method,params={},sessionId=session) {
  return new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}\n${errors.slice(-1000)}`));},15000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
  });
}
async function evaluate(expression) {const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try {
  const target=await send('Target.createTarget',{url:'about:blank'},null);
  session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`file://${root}/site/dist/state-columns.html`});
  await evaluate(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{if(document.querySelector('[data-model-panel]')){clearInterval(timer);resolve();}else if(++tries>100){clearInterval(timer);reject(new Error('Presentation did not initialize'));}},50)})`);
  assert.equal(await evaluate('document.querySelector("#experiment-title").textContent'),'The impossible branch');
  for(let i=0;i<6;i++) {
    await evaluate(`document.querySelector('[data-example="${i}"]').click()`);
    let steps=0;
    while(!await evaluate('document.querySelector("#next").disabled')) {await evaluate('document.querySelector("#next").click()');if(++steps>20)throw new Error('Playback did not terminate');}
    const badge=await evaluate('document.querySelector("#state-badge").textContent');
    assert.ok(badge.includes(['SAFE','SAT','SAFE','SAFE','SAFE','UNKNOWN'][i]),`Wrong final badge ${badge}`);
    if(i===1) assert.equal(await evaluate('document.querySelector(".witness").textContent'),'x = 1');
    if(i===3) assert.equal(await evaluate('document.querySelectorAll(".predicate").length'),2);
    if(i<5) {
      await evaluate('document.querySelector(".legacy-graph").open=true');
      await evaluate('document.querySelector("[data-node]").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
      assert.ok(await evaluate('document.querySelector("#node-inspector").open'));
      await evaluate('document.querySelector("[data-source=llvm]").click()');
      assert.ok((await evaluate('document.querySelector("#source").textContent')).includes('define'));
    }
  }
  // Capture actual 1920×1080 viewport images, not full-page screenshots.
  for(const [example,round,name] of [[0,0,'m0'],[0,1,'m1'],[3,2,'m2'],[1,0,'real-bug']]) {
    await evaluate(`document.querySelectorAll('[data-example]')[${example}].click();document.querySelectorAll('[data-model-round]')[${round}].click();window.scrollTo(0,0)`);
    const bounds=await evaluate(`Object.fromEntries(['.source-pane','#model-lab','.reasoning-pane','.playback'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}]}))`);
    for(const [panel,r] of Object.entries(bounds)) {
      assert.ok(r.x>=0&&r.y>=0&&r.right<=1920&&r.bottom<=1080,`${name} ${panel} is outside the 1920×1080 viewport: ${JSON.stringify(r)}`);
    }
    const fits=await evaluate(`(()=>{const svg=document.querySelector('.abstract-svg'),pane=document.querySelector('.model-scroll').getBoundingClientRect();return [...svg.querySelectorAll('.abstract-state rect')].every(n=>{const r=n.getBoundingClientRect();return r.top>=pane.top&&r.bottom<=pane.bottom&&r.left>=pane.left&&r.right<=pane.right})})()`);
    assert.ok(fits,`${name}: default model states are clipped`);
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:0,y:0,width:1920,height:1080,scale:1}});
    writeFileSync(`${root}/build/screenshots/1920x1080-${name}.png`,Buffer.from(screenshot.data,'base64'));
    console.log(`Captured and checked 1920x1080-${name}.png`);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Mobile page overflows horizontally');
  const mobile=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  writeFileSync(`${root}/build/screenshots/mobile.png`,Buffer.from(mobile.data,'base64'));
  assert.equal(pageErrors.length,0,JSON.stringify(pageErrors));
  console.log('Browser checks passed: all 5 examples, four 1920×1080 viewport captures, panel and model bounds, playback, witnesses, node inspection, LLVM tab, mobile width, no JS exceptions.');
} finally {browser.kill();}
