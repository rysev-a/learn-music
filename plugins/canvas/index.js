// Canvas plugin: mounts a DPR-aware, auto-resizing <canvas> into a host element,
// runs a requestAnimationFrame loop and normalises pointer-drag input.
//
//   const view = createCanvas(host, {
//     draw(ctx, { w, h, dt, time }) { ... },   // called every frame, ctx is in CSS pixels
//     onDrag({ dx, dy, x, y, type }) { ... },  // optional, type: 'down' | 'move' | 'up'
//   });
//   view.stop(); view.start(); view.destroy();

export function createCanvas(host, { draw, onDrag } = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let w = 0, h = 0, raf = 0, last = 0, time = 0, running = false;

  function resize() {
    const r = host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    w = r.width; h = r.height;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function frame(ts) {
    if (!running) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts; time += dt;
    ctx.clearRect(0, 0, w, h);
    if (draw) draw(ctx, { w, h, dt, time });
    raf = requestAnimationFrame(frame);
  }

  let dragging = false, px = 0, py = 0;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!onDrag) return;
    dragging = true; [px, py] = pos(e);
    canvas.setPointerCapture(e.pointerId);
    onDrag({ dx: 0, dy: 0, x: px, y: py, type: 'down' });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const [x, y] = pos(e);
    onDrag({ dx: x - px, dy: y - py, x, y, type: 'move' });
    px = x; py = y;
  });
  const up = (e) => {
    if (!dragging) return;
    dragging = false;
    const [x, y] = pos(e);
    onDrag({ dx: 0, dy: 0, x, y, type: 'up' });
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const api = {
    canvas, ctx,
    get size() { return { w, h }; },
    start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(raf); },
    destroy() { api.stop(); ro.disconnect(); canvas.remove(); },
  };
  api.start();
  return api;
}
