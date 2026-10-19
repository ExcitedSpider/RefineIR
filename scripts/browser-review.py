"""Capture the lab using an existing Chromium and Python's standard library.

Run inside the existing Playwright container; no Playwright package is needed.
The workspace may be mounted read-only. Screenshots are written to /tmp.
"""
import base64
import json
import os
from pathlib import Path
import select
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(os.environ.get('CEGAR_SCREENSHOTS', '/tmp/cegar-visual-review'))
CFG_VIEW = os.environ.get('CEGAR_VIEW', 'cfg') != 'columns'
OUT.mkdir(exist_ok=True)
browser_in, writer = os.pipe()
reader, browser_out = os.pipe()

def configure_pipes():
    os.dup2(browser_in, 3, inheritable=True)
    os.dup2(browser_out, 4, inheritable=True)
    os.set_inheritable(3, True)

browser = subprocess.Popen([
    '/ms-playwright/chromium-1200/chrome-linux64/chrome',
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--allow-file-access-from-files', '--remote-debugging-pipe',
    '--user-data-dir=/tmp/svf-cegar-review-profile', 'about:blank',
], preexec_fn=configure_pipes, close_fds=False, stdout=subprocess.DEVNULL,
   stderr=subprocess.DEVNULL)
sequence = 0
session = None
buffer = b''

def call(method, params=None):
    global sequence, buffer
    sequence += 1
    message = dict(id=sequence, method=method, params=params or {})
    if session:
        message['sessionId'] = session
    os.write(writer, json.dumps(message).encode() + b'\0')
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        while b'\0' in buffer:
            raw, buffer = buffer.split(b'\0', 1)
            response = json.loads(raw)
            if response.get('id') == sequence:
                if 'error' in response:
                    raise RuntimeError(response['error'])
                return response.get('result', {})
        if select.select([reader], [], [], 1)[0]:
            buffer += os.read(reader, 1024 * 1024)
    raise TimeoutError(method)

def evaluate(expression):
    result = call('Runtime.evaluate', dict(expression=expression, returnByValue=True, awaitPromise=True))
    if 'exceptionDetails' in result:
        raise RuntimeError(result['exceptionDetails'])
    return result.get('result', {}).get('value')

try:
    target = call('Target.createTarget', dict(url='about:blank'))['targetId']
    session = call('Target.attachToTarget', dict(targetId=target, flatten=True))['sessionId']
    call('Page.enable')
    call('Emulation.setDeviceMetricsOverride', dict(width=1920, height=1080, deviceScaleFactor=1, mobile=False))
    page = 'index.html' if CFG_VIEW else 'state-columns.html'
    call('Page.navigate', dict(url=f'file://{ROOT}/site/dist/{page}'))
    evaluate("new Promise(resolve=>{const t=setInterval(()=>{if(document.querySelector('[data-model-panel]')){clearInterval(t);resolve(true)}},30)})")
    for example, iteration, comparison, name in [
        (0, 0, False, 'm0'), (0, 1, False, 'm1'),
        (3, 2, False, 'm2'), (3, 2, True, 'comparison'),
        (2, 1, False, 'arithmetic'), (1, 0, False, 'real-bug')
    ]:
        if CFG_VIEW and comparison:
            continue
        evaluate(f"document.querySelectorAll('[data-example]')[{example}].click();document.querySelectorAll('[data-model-round]')[{iteration}].click();window.scrollTo(0,0)")
        if not CFG_VIEW:
            evaluate(f"document.querySelector('#model-{'compare' if comparison else 'single'}').click()")
        evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        bounds = evaluate("Object.fromEntries(['.source-pane','#model-lab','.reasoning-pane','.playback'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,{x:r.x,y:r.y,right:r.right,bottom:r.bottom}]}))")
        assert all(r['x'] >= 0 and r['y'] >= 0 and r['right'] <= 1920 and r['bottom'] <= 1080 for r in bounds.values()), bounds
        clipping = evaluate("""[...document.querySelectorAll('.abstract-state')].flatMap(state=>{
            const rect=state.querySelector('rect').getBoundingClientRect(),pane=state.closest('.model-scroll').getBoundingClientRect();
            const failures=[];
            if(rect.left<pane.left||rect.right>pane.right||rect.top<pane.top||rect.bottom>pane.bottom)failures.push('State outside panel');
            for(const text of state.querySelectorAll('text')){const t=text.getBoundingClientRect();if(t.left<rect.left||t.right>rect.right||t.top<rect.top||t.bottom>rect.bottom)failures.push('Label outside card: '+text.textContent)}
            return failures;
        })""")
        assert not clipping, clipping
        if CFG_VIEW:
            clipping = evaluate("""[...document.querySelectorAll('.cfg-block')].flatMap(block=>{
                const rect=block.querySelector('rect').getBoundingClientRect(),pane=block.closest('.cfg-canvas').getBoundingClientRect();
                const failures=[];
                if(rect.left<pane.left||rect.right>pane.right||rect.top<pane.top||rect.bottom>pane.bottom)failures.push('CFG block outside panel');
                for(const text of block.querySelectorAll('text')){const t=text.getBoundingClientRect();if(t.left<rect.left||t.right>rect.right||t.top<rect.top||t.bottom>rect.bottom)failures.push('CFG label outside card: '+text.textContent)}
                return failures;
            })""")
            assert not clipping, clipping
        image = call('Page.captureScreenshot', dict(format='png', captureBeyondViewport=False))
        (OUT / f'{"cfg-" if CFG_VIEW else ""}1920x1080-{name}.png').write_bytes(base64.b64decode(image['data']))
        print(f'Captured {name}: all workspace panels fit 1920×1080', flush=True)
    if CFG_VIEW:
        evaluate("document.querySelectorAll('[data-example]')[3].click();document.querySelectorAll('[data-model-round]')[2].click();document.querySelectorAll('[data-svf-block]')[2].click()")
        selection = evaluate("({source:document.querySelector('.svf-source-block.active').dataset.svfBlock,graph:document.querySelector('.cfg-block.selected').dataset.cfgBlock,scrollY:window.scrollY})")
        assert selection['source'] == selection['graph'], selection
        assert selection['scrollY'] == 0, selection
        evaluate("document.querySelectorAll('[data-cfg-block]')[1].dispatchEvent(new MouseEvent('click',{bubbles:true}))")
        assert evaluate("document.querySelector('.svf-source-block.active').dataset.svfBlock===document.querySelector('.cfg-block.selected').dataset.cfgBlock")
        image = call('Page.captureScreenshot', dict(format='png', captureBeyondViewport=False))
        (OUT / 'cfg-1920x1080-selection.png').write_bytes(base64.b64decode(image['data']))
        print('Captured selection: source and CFG highlight each other without scrolling the page', flush=True)
        evaluate("document.querySelectorAll('[data-example]')[0].click();document.querySelector('#reset').click();for(let i=0;i<3;i++)document.querySelector('#next').click()")
        assert evaluate("document.querySelector('#solver-content').textContent.includes('proved by Z3')")
        image = call('Page.captureScreenshot', dict(format='png', captureBeyondViewport=False))
        (OUT / 'cfg-1920x1080-refinement-evidence.png').write_bytes(base64.b64decode(image['data']))
        evaluate("document.querySelector('[data-z3-round]').click()")
        assert evaluate("document.querySelector('#z3-dialog').open && document.querySelector('.z3-input').textContent.includes('check-sat-assuming') && document.querySelector('.z3-response').textContent.startsWith('unsat')")
        assert evaluate("(()=>{const r=document.querySelector('#z3-dialog').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=1920&&r.bottom<=1080})()")
        image = call('Page.captureScreenshot', dict(format='png', captureBeyondViewport=False))
        (OUT / 'cfg-1920x1080-z3-session.png').write_bytes(base64.b64decode(image['data']))
        evaluate("document.querySelector('#z3-dialog header button').click()")
        for example, iteration in [(0, 0), (0, 1), (3, 2)]:
            evaluate(f"document.querySelectorAll('[data-example]')[{example}].click();document.querySelectorAll('[data-model-round]')[{iteration}].click();document.querySelector('#view-tla').click();window.scrollTo(0,0)")
            assert evaluate("Boolean(document.querySelector('.tla-code'))")
            assert evaluate("(()=>{const r=document.querySelector('.tla-panel').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=1920&&r.bottom<=1080})()")
            assert evaluate("document.querySelector('.tla-status').textContent.includes('TLC has not been run')")
            image = call('Page.captureScreenshot', dict(format='png', captureBeyondViewport=False))
            (OUT / f'tla-1920x1080-m{iteration}.png').write_bytes(base64.b64decode(image['data']))
            print(f'Captured TLA+ M{iteration}: model panel fits the viewport', flush=True)
finally:
    browser.terminate()
    browser.wait(timeout=10)
