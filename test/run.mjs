#!/usr/bin/env node
/* Runs test/suite.js inside mica.html in a real browser and prints the result.

     node test/run.mjs                    headless Chrome, Chromium or Edge
     node test/run.mjs --webkit           WebKit, Safari's engine, offscreen (macOS)
     node test/run.mjs --page build.html  test another build of the page

   CHROME=/path/to/browser picks the browser. Every run starts from empty
   storage, like a first visit, and opens the page from a file:// URL, like a
   double-click. The exit code is 1 when a check fails. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webshot } from '../tools/webkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const page = path.resolve(arg('--page') || path.join(ROOT, 'mica.html'));
const suite = readFileSync(path.join(ROOT, 'test', 'suite.js'), 'utf8');
const WIDTH = 1440, HEIGHT = 900;

/* Collects anything the page reports as an error; the suite's last check reads it. */
const TRAP = `window.__pageErrors = [];
addEventListener('error', e => __pageErrors.push(String(e.message || e)));
addEventListener('unhandledrejection', e => __pageErrors.push('unhandled rejection: ' + (e.reason && e.reason.message || e.reason)));
{ const error = console.error; console.error = (...a) => { __pageErrors.push(a.map(String).join(' ')); error.apply(console, a); }; }`;

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try { return execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { /* not installed */ }
  }
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(p => existsSync(p)) || null;
}

/* A minimal Chrome DevTools Protocol client over Node's built-in WebSocket. */
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map(), waiters = [];
  let id = 0;
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      return;
    }
    for (const w of waiters.slice()) {
      if (w.method === msg.method && w.sessionId === msg.sessionId) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.params); }
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('error', () => reject(new Error('could not connect to the browser')));
    ws.addEventListener('open', () => resolve({
      send: (method, params = {}, sessionId) => new Promise((res, rej) => {
        pending.set(++id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      }),
      once: (method, sessionId) => new Promise(res => waiters.push({ method, sessionId, resolve: res })),
      close: () => ws.close(),
    }));
  });
}

async function inChrome() {
  const binary = findChrome();
  if (!binary) throw new Error('no Chrome, Chromium or Edge found: install one, set CHROME=/path/to/browser, or run with --webkit on macOS');
  const profile = mkdtempSync(path.join(tmpdir(), 'mica-test-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`];
  if (process.env.CI) flags.push('--no-sandbox');
  const chrome = spawn(binary, [...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(r => chrome.on('exit', r));
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('the browser did not start:\n' + log.slice(-600))), 30000);
      chrome.stderr.on('data', d => {
        log += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      exited.then(code => { clearTimeout(timer); reject(new Error(`the browser quit (code ${code}):\n${log.slice(-600)}`)); });
    });
    const cdp = await connect(wsUrl);
    const { product } = await cdp.send('Browser.getVersion');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: TRAP });
    const loaded = cdp.once('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url: pathToFileURL(page).href });
    await loaded;
    const r = await send('Runtime.evaluate', { expression: `${suite}\n__micaTests()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('the suite itself failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    cdp.close();
    return { browser: product.replace('/', ' '), ...r.result.value };
  } finally {
    chrome.kill();
    await Promise.race([exited, new Promise(r => setTimeout(r, 3000))]);
    /* The browser's helpers can still be writing to the profile; a folder left
       in the temp directory must never hide the real result. */
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* left for the OS */ }
  }
}

async function inWebKit() {
  const plan = { width: WIDTH, height: HEIGHT, preload: TRAP, steps: [{ js: `${suite}\nreturn JSON.stringify(await __micaTests());` }] };
  const out = await webshot(page, plan);
  const line = out.split('\n').find(l => l.startsWith('[0] '));
  if (!line || line.startsWith('[0] JS error')) throw new Error('the suite itself failed in WebKit:\n' + out);
  const result = JSON.parse(line.slice(4));
  const version = /AppleWebKit\/([\d.]+)/.exec(result.agent || '');
  return { browser: 'WebKit ' + (version ? version[1] : ''), ...result };
}

const started = performance.now();
try {
  const r = await (args.includes('--webkit') ? inWebKit() : inChrome());
  for (const t of r.results) console.log(t.ok ? `  ✓ ${t.name}` : `  ✗ ${t.name}\n      ${t.detail}`);
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\n${r.passed} passed, ${r.failed} failed · ${r.browser} · ${secs} s`);
  process.exit(r.failed ? 1 : 0);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
