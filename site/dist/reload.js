(() => {
  'use strict';
  // Works with the existing static LAN server; no watcher service is needed.
  if (!/^https?:$/.test(location.protocol)) return;
  const files = ['index.html', 'cfg.html', 'state-columns.html', 'style.css', 'cfg.css', 'app.js', 'model.js', 'cfg.js', 'tla.js', 'data/results.js', 'reload.js'];
  let baseline = null, candidate = null, busy = false;
  async function poll() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const contents = await Promise.all(files.map(async file => {
        const response = await fetch(new URL(file, location.href), { cache: 'no-store' });
        if (!response.ok) throw new Error('Presentation temporarily unavailable');
        return response.text();
      }));
      const snapshot = JSON.stringify(contents);
      if (baseline === null) baseline = snapshot;
      if (snapshot === baseline) candidate = null;
      else if (snapshot === candidate) {
        // Wait for two identical reads to avoid reloading during a file write.
        window.dispatchEvent(new Event('cegar:before-reload'));
        location.reload();
      } else candidate = snapshot;
    } catch {
      // A stopped server or a partial save should leave the current page usable.
      candidate = null;
    } finally {
      busy = false;
    }
  }
  poll();
  setInterval(poll, 2000);
  document.addEventListener('visibilitychange', poll);
})();
