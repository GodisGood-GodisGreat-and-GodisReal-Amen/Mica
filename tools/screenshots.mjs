#!/usr/bin/env node
/* Regenerates the pictures in docs/images/ in WebKit, offscreen (macOS).

     node tools/screenshots.mjs           every picture
     node tools/screenshots.mjs dark cpu  only these

   Each picture starts from a fresh page at 1280 × 800 and drives it like the
   tests do. WebKit renders it at 2x; sips scales that to 1600 px wide, and the
   PNG is re-encoded losslessly with only the chunks a browser needs, so it
   carries no metadata. Offscreen snapshots don't render backdrop blur; with
   the default background Mica uses none anyway. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { webshot } from './webkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'images');
const WIDTH = 1280, HEIGHT = 800, OUT_WIDTH = 1600;

/* Shared page helpers, installed as window.$h by the first step of every plan. */
const HELPERS = `
const byId = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const press = (el, key, opts = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
const until = async (fn, ms = 5000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) return false; await sleep(15); } return true; };
const set = (el, v) => { el.value = String(v); fire(el, 'input'); fire(el, 'change'); };
const tab = (group, name) => document.querySelector('[data-tabs="' + group + '"] [data-tab="' + name + '"]').click();
const example = async name => { const before = byId('asmEditor').value; set(byId('exampleSelect'), name); await until(() => byId('asmEditor').value !== before); await sleep(50); };
const type = async text => { await until(() => !byId('ttyInput').disabled); byId('ttyInput').value = text; press(byId('ttyInput'), 'Enter'); await sleep(30); };
const breakAt = async line => { const ed = byId('asmEditor'); ed.scrollTop = Math.max(0, line * 20 - 200); fire(ed, 'scroll'); await sleep(80); document.querySelector('#asmGutter .ln[data-line="' + line + '"]').click(); };
const lineOf = text => byId('asmEditor').value.split('\\n').findIndex(l => l.startsWith(text));
const scrollEditorTo = async line => { const ed = byId('asmEditor'); ed.scrollTop = Math.max(0, line * 20 - 60); fire(ed, 'scroll'); await sleep(80); };
window.$h = { byId, sleep, fire, press, until, set, tab, example, type, breakAt, lineOf, scrollEditorTo };
await until(() => !document.documentElement.classList.contains('preload'));
await sleep(900);
return 'ready';`;

const SHOTS = {
  /* the README's first picture: the kernel's shell answering a command */
  mica: { theme: 'light', js: `
    const { byId, set, example, type, until, sleep, lineOf, scrollEditorTo } = $h;
    await example('kernel');
    set(byId('clockAsmNum'), 0);
    byId('btnRun').click();
    await until(() => byId('statusText').textContent === 'AWAITING INPUT');
    await type('f'); await type('12');
    await type('!'); await type('6');
    set(byId('clockAsmNum'), 180);
    await scrollEditorTo(lineOf('repl:'));
    await sleep(800);
    await sleep(400);` },
  /* dark theme, paused on a breakpoint, CPU tab open, manual folded away */
  dark: { theme: 'dark', js: `
    const { byId, set, example, until, sleep, breakAt, tab } = $h;
    byId('manualCollapse').click();
    await example('factorial');
    set(byId('clockAsmNum'), 0);
    await breakAt(byId('asmEditor').value.split('\\n').indexOf('MUL R1, R2'));
    tab('machine', 'cpu');
    byId('btnRun').click();
    await until(() => byId('statusText').textContent === 'PAUSED · BREAKPOINT');
    byId('btnRun').click();
    await until(() => byId('statusText').textContent === 'PAUSED · BREAKPOINT');
    set(byId('clockAsmNum'), 180);
    await sleep(400);` },
  /* an instruction patched live */
  cpu: { theme: 'light', js: `
    const { byId, set, fire, until, sleep, tab } = $h;
    byId('manualCollapse').click();
    tab('machine', 'cpu');
    await sleep(100);
    const card = [...document.querySelectorAll('#cpuOps .op-card')].find(c => c.querySelector('.op-name').textContent === 'INC');
    card.click();
    const ta = card.querySelector('.op-textarea');
    ta.value = 'function INC(dst) {\\n  // count in twos\\n  const r = read(dst) + 2;\\n  write(dst, r);\\n  setFlags(r);\\n}';
    fire(ta, 'input');
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Apply').click();
    set(byId('clockAsmNum'), 0);
    byId('btnRun').click();
    await until(() => byId('statusText').textContent === 'HALTED');
    card.closest('.op-cat').scrollIntoView({ block: 'start' });
    await sleep(500);` },
  /* the System tab after HELP */
  system: { theme: 'dark', js: `
    const { byId, set, fire, until, sleep, tab } = $h;
    tab('editor', 'host');
    set(byId('hostPaceNum'), 0);
    byId('btnHostRun').click();
    await until(() => !byId('btnHostRun').disabled);
    await sleep(500);` },
  /* the settings drawer */
  settings: { theme: 'light', js: `
    const { byId, sleep } = $h;
    byId('settingsToggle').click();
    await sleep(700);
    document.activeElement.blur();
    await sleep(200);` },
};

/* --- lossless PNG re-encoding (RGBA or RGB, 8-bit, not interlaced) ----------- */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function optimizePng(file) {
  const png = readFileSync(file);
  let pos = 8, ihdr = null;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error(`${file}: unexpected PNG format`);
  const bpp = colorType === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      let p = line[i];
      if (f === 1) p += a; else if (f === 2) p += b; else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = p & 0xff;
    }
  }
  /* drop the alpha channel when every pixel is opaque */
  let opaque = bpp === 4;
  for (let i = 3; opaque && i < px.length; i += 4) if (px[i] !== 255) opaque = false;
  const ob = opaque ? 3 : bpp, os = w * ob;
  const rgb = opaque ? Buffer.alloc(h * os) : px;
  if (opaque) for (let s = 0, d = 0; s < px.length; s += 4, d += 3) { rgb[d] = px[s]; rgb[d + 1] = px[s + 1]; rgb[d + 2] = px[s + 2]; }
  /* filter each row with whichever filter gives the smallest sum of magnitudes */
  const filtered = Buffer.alloc(h * (os + 1));
  const trial = Buffer.alloc(os);
  for (let y = 0; y < h; y++) {
    const cur = rgb.subarray(y * os, (y + 1) * os), up = y ? rgb.subarray((y - 1) * os, y * os) : null;
    let best = Infinity, bestF = 0;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < os; i++) {
        const a = i >= ob ? cur[i - ob] : 0, b = up ? up[i] : 0, c = up && i >= ob ? up[i - ob] : 0;
        let pred = 0;
        if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (cur[i] - pred) & 0xff;
        trial[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < best) { best = sum; bestF = f; trial.copy(filtered, y * (os + 1) + 1); }
    }
    filtered[y * (os + 1)] = bestF;
  }
  const head = Buffer.from(ihdr);
  head[9] = opaque ? 2 : colorType;
  const srgb = Buffer.from([0]); /* perceptual intent: the snapshot is rendered in sRGB */
  const out = Buffer.concat([png.subarray(0, 8), chunk('IHDR', head), chunk('sRGB', srgb),
    chunk('IDAT', deflateSync(filtered, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(file, out);
  return out.length;
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SHOTS);
mkdirSync(OUT, { recursive: true });
for (const name of names) {
  const shot = SHOTS[name];
  if (!shot) { console.error(`no picture called "${name}" (have: ${Object.keys(SHOTS).join(', ')})`); process.exit(1); }
  const tmp = mkdtempSync(path.join(tmpdir(), 'mica-shot-'));
  const plan = {
    width: WIDTH, height: HEIGHT,
    storage: { 'mica:theme': shot.theme },
    steps: [{ js: HELPERS, log: false }, { js: shot.js, log: false }, { shot: name + '.png' }],
  };
  await webshot(path.join(ROOT, 'mica.html'), plan, tmp);
  const dest = path.join(OUT, name + '.png');
  renameSync(path.join(tmp, name + '.png'), dest);
  rmSync(tmp, { recursive: true, force: true });
  execFileSync('sips', ['--resampleWidth', String(OUT_WIDTH), dest, '--out', dest], { stdio: 'ignore' });
  console.log(`docs/images/${name}.png  ${(optimizePng(dest) / 1024).toFixed(0)} KB`);
}
