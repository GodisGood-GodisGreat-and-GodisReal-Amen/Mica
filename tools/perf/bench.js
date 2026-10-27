/* Benchmark scenarios for Mica. Load this file into the page (or into both
   frames of harness.html to compare two builds), then call the scenarios on
   window.__bench, e.g. await __bench.instant(). Each returns a small result
   object. */
(() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const byId = id => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  const A = {
    name: document.querySelector('.foot-brand') ? document.querySelector('.foot-brand').textContent.trim() : 'Mica',
    editor: () => byId('asmEditor'),
    setClock: ms => { const n = byId('speedNum'); n.value = ms; fire(n, 'input'); },
    run: () => byId('btnRun').click(),
    pause: () => byId('btnPause').click(),
    reset: () => byId('btnReset').click(),
    cycles: () => parseInt(byId('cycleCount').textContent, 10),
    theme: () => byId('themeQuick').click(),
    drawer: open => (open ? byId('settingsToggle') : byId('settingsClose')).click(),
    loadKernel: () => { const s = byId('exampleSelect'); s.value = 'kernel'; fire(s, 'change'); },
    divider: () => byId('dividerV'),
    moveTarget: () => byId('dividerV'),
  };

  const PROG = [
    '; bench: registers, flags, memory reads and writes every iteration',
    'MOV R2, 16',
    'loop:',
    'INC R1',
    'STORE R2, R1',
    'MOV R3, [R2]',
    'ADD R4, R3',
    'INC R2',
    'AND R2, 511',
    'OR R2, 16',
    'CMP R1, 0',
    'JMP loop',
  ].join('\n');
  const PROG_OUT = PROG.replace('JMP loop', 'OUT R1\nJMP loop');

  function setProgram(text) {
    const ed = A.editor();
    ed.value = text;
    fire(ed, 'input');
  }

  /* Probes: rAF frame deltas + idle time via requestIdleCallback. */
  function startProbes() {
    const st = { deltas: [], idle: 0, stop: false, t0: performance.now(), last: 0 };
    const frame = t => {
      if (st.stop) return;
      if (st.last) st.deltas.push(t - st.last);
      st.last = t;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const idle = d => {
      if (st.stop) return;
      st.idle += d.timeRemaining();
      requestIdleCallback(idle);
    };
    if (window.requestIdleCallback) requestIdleCallback(idle);
    return st;
  }
  function stopProbes(st, nominal) {
    st.stop = true;
    const span = performance.now() - st.t0;
    const d = st.deltas.slice().sort((a, b) => a - b);
    const q = p => d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : 0;
    const long = st.deltas.filter(x => x > nominal * 1.9);
    return {
      frames: st.deltas.length,
      fps: +(st.deltas.length / (span / 1000)).toFixed(1),
      p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1),
      max: +(d[d.length - 1] || 0).toFixed(1),
      longFrames: long.length,
      droppedMs: +long.reduce((s, x) => s + (x - nominal), 0).toFixed(0),
      idlePct: +(100 * st.idle / span).toFixed(1),
    };
  }

  const B = {
    nominal: 16.7,
    async calibrate() {
      await sleep(300);
      const st = startProbes();
      await sleep(1200);
      const r = stopProbes(st, 1e9);
      B.nominal = r.p50 || 16.7;
      return { app: A.name, visible: document.visibilityState, vw: innerWidth, vh: innerHeight, nominalFrameMs: B.nominal, idleFps: r.fps, idlePct: r.idlePct };
    },
    async instant() {
      setProgram(PROG);
      A.setClock(0);
      A.reset();
      await sleep(200);
      const t0 = performance.now();
      A.run();
      const tSync = performance.now() - t0;
      const cSync = A.cycles();
      await sleep(2300);
      A.pause();
      const el = performance.now() - t0;
      const c = A.cycles();
      return { test: 'instant', syncMips: +(cSync / tSync / 1000).toFixed(2), cycles: c, ms: Math.round(el), mips: +(c / el / 1000).toFixed(2), syncPhaseMs: Math.round(tSync) };
    },
    async clocked(ms, seconds = 4, withOut = true) {
      setProgram(withOut ? PROG_OUT : PROG);
      A.setClock(ms);
      A.reset();
      await sleep(300);
      const st = startProbes();
      const t0 = performance.now();
      A.run();
      await sleep(seconds * 1000);
      A.pause();
      const el = performance.now() - t0;
      const r = stopProbes(st, B.nominal);
      const c = A.cycles();
      const ideal = ms === 0 ? null : Math.round(el / Math.max(ms, 0.0001));
      return Object.assign({ test: 'clock ' + ms + 'ms', cycles: c, ideal, rate: ms === 0 ? null : +(100 * c / ideal).toFixed(1) }, r);
    },
    async theme() {
      await sleep(300);
      const st = startProbes();
      let sync = 0;
      for (let i = 0; i < 4; i++) {
        const t = performance.now();
        A.theme();
        sync += performance.now() - t;
        await sleep(650);
      }
      const r = stopProbes(st, B.nominal);
      return Object.assign({ test: 'theme x4', syncMsTotal: +sync.toFixed(1) }, r);
    },
    async drawer() {
      await sleep(300);
      const st = startProbes();
      for (let i = 0; i < 2; i++) {
        A.drawer(true); await sleep(700);
        A.drawer(false); await sleep(700);
      }
      const r = stopProbes(st, B.nominal);
      return Object.assign({ test: 'drawer x2' }, r);
    },
    async typing() {
      A.loadKernel();
      await sleep(400);
      const ed = A.editor();
      const orig = ed.value;
      ed.focus();
      let total = 0;
      const N = 40;
      for (let i = 0; i < N; i++) {
        await sleep(16);
        const t = performance.now();
        ed.value = ed.value + (i % 10 === 9 ? '\n' : 'x');
        ed.selectionStart = ed.selectionEnd = ed.value.length;
        fire(ed, 'input');
        void document.body.offsetHeight; /* include style + layout of this keystroke */
        total += performance.now() - t;
      }
      ed.value = orig;
      fire(ed, 'input');
      ed.blur();
      await sleep(500);
      return { test: 'typing kernel', keystrokes: N, msPerKey: +(total / N).toFixed(2) };
    },
    async divider() {
      await sleep(300);
      const div = A.divider();
      const r0 = div.getBoundingClientRect();
      const x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
      const ev = (type, x) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y0, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true });
      const st = startProbes();
      div.dispatchEvent(ev('pointerdown', x0));
      let handler = 0;
      for (let i = 0; i < 90; i++) {
        await sleep(16);
        const x = x0 + Math.round(120 * Math.sin(i / 90 * Math.PI * 2));
        const t = performance.now();
        /* two moves per frame, like a 120 Hz trackpad */
        A.moveTarget().dispatchEvent(ev('pointermove', x));
        A.moveTarget().dispatchEvent(ev('pointermove', x + 1));
        void document.body.offsetHeight;
        handler += performance.now() - t;
      }
      A.moveTarget().dispatchEvent(ev('pointerup', x0));
      document.dispatchEvent(ev('pointerup', x0));
      const r = stopProbes(st, B.nominal);
      return Object.assign({ test: 'divider drag', msPerFrameWork: +(handler / 90).toFixed(2) }, r);
    },
  };
  /* Main-thread cost per run tick at a timed clock: wraps the app's setInterval
     callback, then forces style + layout so the cost of the DOM changes it made
     is included (paint is not measurable off-screen). Also counts the CSS
     transitions the run starts. */
  B.tickCost = async function (ms, seconds = 3) {
    setProgram(PROG_OUT);
    A.setClock(ms);
    A.reset();
    await sleep(300);
    const origSI = window.setInterval;
    let work = 0, ticks = 0, worst = 0;
    window.setInterval = function (fn, delay, ...rest) {
      return origSI.call(window, function () {
        const t = performance.now();
        fn.apply(this, arguments);
        void document.body.offsetHeight;
        const d = performance.now() - t;
        work += d; ticks++; if (d > worst) worst = d;
      }, delay, ...rest);
    };
    let transitions = 0;
    const onT = () => { transitions++; };
    document.addEventListener('transitionrun', onT, true);
    A.run();
    await sleep(seconds * 1000);
    A.pause();
    window.setInterval = origSI;
    await sleep(1200); /* let queued transition events arrive */
    document.removeEventListener('transitionrun', onT, true);
    const anims = document.getAnimations().length;
    return { test: 'tick cost @' + ms + 'ms', ticks, msPerTick: +(work / Math.max(1, ticks)).toFixed(3), worstTickMs: +worst.toFixed(2), transitionsStarted: transitions, transitionsPerSec: +(transitions / seconds).toFixed(1), liveAnimationsAfter: anims };
  };
  /* Theme flip: synchronous cost including the forced restyle + layout, and how
     many animations the flip creates. */
  B.themeCost = async function () {
    const out = [];
    for (let i = 0; i < 2; i++) {
      await sleep(400);
      const t = performance.now();
      A.theme();
      getComputedStyle(document.body).color;
      void document.body.offsetHeight;
      const ms = performance.now() - t;
      const created = document.getAnimations().length;
      out.push({ ms: +ms.toFixed(1), animationsCreated: created });
      await sleep(900);
    }
    return { test: 'theme flip', runs: out };
  };
  B.drawerCost = async function () {
    await sleep(300);
    const t = performance.now();
    A.drawer(true);
    void document.body.offsetHeight;
    const openMs = performance.now() - t;
    const created = document.getAnimations().length;
    await sleep(800);
    A.drawer(false);
    await sleep(800);
    return { test: 'drawer open', openMs: +openMs.toFixed(1), animationsCreated: created };
  };
  B.frameRate = async function () {
    const st = startProbes();
    await sleep(600);
    const r = stopProbes(st, 1e9);
    return r.fps;
  };

  window.__bench = B;
  window.__benchResults = window.__benchResults || [];
  window.__benchApp = A.name;
})();
