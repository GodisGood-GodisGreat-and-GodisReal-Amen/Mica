/* ==========================================================================
   Mica — application
   One self-contained script: machine core, assembler, scheduler, host
   commands, hybrid runner, views, settings, windows and keyboard. The op
   functions are shown to the user in the CPU tab and can be live-patched,
   so they are written to read well.
   ========================================================================== */
(() => {
'use strict';

/* ---------- §0 utilities ------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const byId = id => document.getElementById(id);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtHex2 = n => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
const fmtAddr = n => '0x' + n.toString(16).toUpperCase().padStart(3, '0');
const fmtNum = n => Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
const html = document.documentElement;

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v); /* true = boolean attribute (hidden, disabled); pass 'true' for ARIA states */
  }
  for (const c of kids) if (c != null) el.append(c);
  return el;
}
function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  return d;
}
const reducedMotion = () => html.dataset.motion === 'reduce' ||
  (html.dataset.motion !== 'full' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const wideScreen = matchMedia('(min-width: 881px)');

const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mica:' + k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mica:' + k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem('mica:' + k); } catch (e) {} },
  legacy(k) { try { return localStorage.getItem('nanoos-' + k); } catch (e) { return null; } },
};

/* ---------- §1 settings -------------------------------------------------- */
const DEFAULTS = {
  sound: 'off', volume: 50, muted: false, pitch: 220,
  divZero: true, lint: true, strict: false, live: false,
  base: 'dec', tips: true, motion: 'auto',
  defaultClock: 180, tabClocks: { asm: 180, host: 180, hybrid: 180 }, clockSep: true, clockAuto: true,
  hostPace: 100, hybridPace: 100,
  pins: { clock: true },
  manualCollapsed: false, colEditor: null, rowManual: null, ttyHeight: null,
};
const PIN_ORDER = ['theme', 'sound', 'volume', 'pitch', 'divZero', 'base', 'lint', 'strict', 'clock'];
const S = loadSettings(); /* mutated in place, never replaced */
const saveSettings = debounce(() => store.set('settings', JSON.stringify(S)), 250);

function loadSettings() {
  const s = JSON.parse(JSON.stringify(DEFAULTS));
  const raw = store.get('settings');
  if (raw) {
    try { Object.assign(s, JSON.parse(raw)); } catch (e) {}
  } else {
    migrateLegacy(s);
  }
  s.tabClocks = Object.assign({}, DEFAULTS.tabClocks, s.tabClocks);
  s.pins = Object.assign({}, DEFAULTS.pins, s.pins);
  return s;
}
/* First launch only: adopt the preferences saved by pre-release builds, whose
   keys start with nanoos-, so nothing is lost. */
function migrateLegacy(s) {
  const L = store.legacy;
  const num = (k, lo, hi) => { const v = parseFloat(L(k)); return Number.isNaN(v) ? null : clamp(v, lo, hi); };
  if (L('display') === 'hex') s.base = 'hex';
  const snd = L('sound');
  if (snd && ['sine', 'square', 'triangle', 'sawtooth'].includes(snd)) s.sound = snd;
  else if (snd === 'custom' && L('beepfile')) s.sound = 'custom';
  const vol = num('volume', 0, 100); if (vol !== null) s.volume = vol;
  if (L('muted') === '1') s.muted = true;
  const pitch = num('pitch', 50, 2000); if (pitch !== null) s.pitch = Math.round(pitch);
  if (L('divzero') === '0') s.divZero = false;
  if (L('lint') === '0') s.lint = false;
  if (L('strict') === '1') s.strict = true;
  if (L('live') === '1') s.live = true;
  if (L('hover-info') === '0') s.tips = false;
  const dc = num('default-clock', 0, 1e9); if (dc !== null) s.defaultClock = dc;
  try {
    const tc = JSON.parse(L('tab-clocks') || 'null');
    if (tc && typeof tc === 'object') for (const t of ['asm', 'host', 'hybrid']) if (typeof tc[t] === 'number') s.tabClocks[t] = Math.max(0, tc[t]);
  } catch (e) {}
  if (L('clock-unlinked') === '0') s.clockSep = false;
  if (L('clock-autoswitch') === '0') s.clockAuto = false;
  try {
    const pins = JSON.parse(L('footer-pins') || 'null');
    const map = { divzero: 'divZero', hex: 'base' };
    if (Array.isArray(pins)) pins.forEach(k => { s.pins[map[k] || k] = true; });
    else if (pins && typeof pins === 'object') for (const k in pins) s.pins[map[k] || k] = !!pins[k];
  } catch (e) {}
}

/* ---------- §2 machine --------------------------------------------------- */
const MEM_SIZE = 1024;
const REGS = ['R1', 'R2', 'R3', 'R4'];
const cpu = freshCPU(); /* mutated in place, never replaced: ops hold a reference */
let program = [];
let labels = {};
let cycles = 0;
let recentWrite = -1;
let regSnapshot = {};

function freshCPU() {
  return {
    registers: { R1: 0, R2: 0, R3: 0, R4: 0 },
    pc: 0, sp: MEM_SIZE - 1,
    flags: { ZF: 0, SF: 0 },
    memory: new Array(MEM_SIZE).fill(0),
    halted: false, waitingFor: null, wasRunning: false,
  };
}

/* assembler */
function stripComment(line) { const i = line.indexOf(';'); return i === -1 ? line : line.slice(0, i); }
function splitLabel(line) {
  if (line.endsWith(':') && !line.includes(' ')) return { label: line.slice(0, -1).trim().toUpperCase(), rest: '' };
  const colon = line.indexOf(':');
  if (colon > 0 && !line.slice(0, colon).includes(' ')) return { label: line.slice(0, colon).trim().toUpperCase(), rest: line.slice(colon + 1).trim() };
  return { label: null, rest: line };
}
function tokenize(line) {
  const out = [];
  let cur = '', inBracket = false;
  for (const ch of line) {
    if (ch === '[') { if (cur.trim()) out.push(cur.trim()); cur = '['; inBracket = true; }
    else if (ch === ']') { cur += ']'; out.push(cur.trim()); cur = ''; inBracket = false; }
    else if (!inBracket && (ch === ',' || ch === ' ' || ch === '\t')) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(t => t.toUpperCase());
}
function assemble(text) {
  const prog = [], lab = {};
  text.split('\n').forEach((raw, idx) => {
    const line = stripComment(raw).trim();
    if (!line) return;
    const { label, rest } = splitLabel(line);
    if (label) lab[label] = prog.length;
    if (!rest) return;
    const tokens = tokenize(rest);
    if (tokens.length) prog.push({ tokens, line: idx, op: OPS[tokens[0]] || null, a: tokens[1], b: tokens[2] });
  });
  return { program: prog, labels: lab };
}
function lintText(text) {
  const errs = new Map();
  text.split('\n').forEach((raw, idx) => {
    const line = stripComment(raw).trim();
    if (!line) return;
    const { rest } = splitLabel(line);
    if (!rest) return;
    const t = tokenize(rest);
    if (!t.length) return;
    const def = OPS[t[0]];
    if (!def) { errs.set(idx, `unknown instruction "${t[0]}"` + (HOST[t[0]] ? ' — that is a System command' : '')); return; }
    const n = t.length - 1;
    if (n !== def.arity) errs.set(idx, `${t[0]} takes ${def.arity} operand${def.arity === 1 ? '' : 's'}, got ${n}`);
  });
  return errs;
}

/* operands */
const LIT = new Map();
function literal(tok) {
  let n = LIT.get(tok);
  if (n === undefined) {
    if (/^-?0X[0-9A-F]+$/.test(tok)) n = parseInt(tok, 16);
    else if (/^-?0B[01]+$/.test(tok)) n = parseInt(tok.replace(/^(-?)0B/, '$1'), 2);
    else if (/^-?\d+$/.test(tok)) n = parseInt(tok, 10);
    else n = NaN;
    if (LIT.size > 4096) LIT.clear();
    LIT.set(tok, n);
  }
  return n;
}
const INNER = new Map();
function inner(arg) {
  let v = INNER.get(arg);
  if (v === undefined) {
    v = arg.slice(1, -1).trim();
    if (INNER.size > 4096) INNER.clear();
    INNER.set(arg, v);
  }
  return v;
}
function read(arg) {
  if (arg === undefined) throw new Error('Missing operand');
  if (arg.charCodeAt(0) === 91 && arg.charCodeAt(arg.length - 1) === 93) {
    const addr = read(inner(arg));
    if (addr < 0 || addr >= MEM_SIZE) throw new Error('Memory read out of range: ' + addr);
    return cpu.memory[addr];
  }
  const r = cpu.registers[arg];
  if (r !== undefined) return r;
  if (arg === 'PC') return cpu.pc;
  if (arg === 'SP') return cpu.sp;
  const l = labels[arg];
  if (l !== undefined) return l;
  const n = literal(arg);
  if (Number.isNaN(n)) throw new Error(`Cannot resolve "${arg}"`);
  return n;
}
function writeReg(name, value) {
  if (cpu.registers[name] !== undefined) cpu.registers[name] = value;
  else if (name === 'PC') cpu.pc = value;
  else if (name === 'SP') cpu.sp = value;
  else throw new Error(`Cannot write to "${name}"`);
}
function writeMem(addr, value) {
  if (addr < 0 || addr >= MEM_SIZE) throw new Error('Memory write out of range: ' + addr);
  cpu.memory[addr] = value | 0;
  recentWrite = addr;
  audio.beep(value);
}
function write(dst, value) {
  if (dst === undefined) throw new Error('Missing destination');
  if (dst.charCodeAt(0) === 91 && dst.charCodeAt(dst.length - 1) === 93) writeMem(read(inner(dst)), value);
  else writeReg(dst, value);
}
function setFlags(result) {
  cpu.flags.ZF = result === 0 ? 1 : 0;
  cpu.flags.SF = result < 0 ? 1 : 0;
}
function jump(target) {
  if (target === undefined) throw new Error('Missing jump target');
  cpu.pc = labels[target] !== undefined ? labels[target] : read(target);
  return true;
}
function print(value) { tty.line('<span class="dim">›</span> ' + value); }
function printChar(code) { tty.char(code & 0xff); }
function halt() {
  cpu.halted = true;
  setStatus('HALTED', 'warn');
  tty.line('<span class="dim">── halted ──</span>');
  onHalt();
}

/* ---------- §3 instruction set ------------------------------------------ */
/* Each op is a small function kept as source text: the CPU tab shows exactly
   this text and you can patch it live. Its helpers are passed in explicitly:
   read(x), write(dst, v), writeReg(reg, v), writeMem(addr, v), setFlags(r),
   jump(target), print(v), printChar(c), requestInput(dst), halt(), cpu,
   MEM_SIZE and S (settings). An op returns true when it set PC itself. */
const OP_HELPERS = ['read', 'write', 'writeReg', 'writeMem', 'setFlags', 'jump', 'print', 'printChar', 'requestInput', 'halt', 'cpu', 'MEM_SIZE', 'S'];
function compileOp(src) {
  const make = new Function(...OP_HELPERS, '"use strict"; return (' + src + '\n);');
  return make(read, write, writeReg, writeMem, setFlags, jump, print, printChar, requestInput, halt, cpu, MEM_SIZE, S);
}
const OPS = {};
const CATEGORIES = [
  { title: 'Data movement', ops: ['MOV', 'LOAD', 'STORE'] },
  { title: 'Arithmetic', ops: ['ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'INC', 'DEC'] },
  { title: 'Bitwise', ops: ['AND', 'OR', 'XOR', 'NOT', 'SHL', 'SHR'] },
  { title: 'Compare & jump', ops: ['CMP', 'JMP', 'JEQ', 'JNE', 'JLT', 'JGE', 'JGT', 'JLE'] },
  { title: 'Stack', ops: ['PUSH', 'POP', 'CALL', 'RET'] },
  { title: 'Input / output', ops: ['OUT', 'OUTC', 'IN'] },
  { title: 'Control', ops: ['NOP', 'HLT'] },
];
/* name, operand count, syntax, summary, manual note, source */
const OP_TABLE = [
  ['MOV', 2, 'dst, src', 'dst = src', 'Copy src into dst. src can be a register, a literal, a label or [addr].', `function MOV(dst, src) {
  write(dst, read(src));
}`],
  ['LOAD', 2, 'reg, addr', 'reg = memory[addr]', 'Read the cell at addr into reg.', `function LOAD(reg, addr) {
  const a = read(addr);
  if (a < 0 || a >= MEM_SIZE) throw new Error('Memory read out of range: ' + a);
  writeReg(reg, cpu.memory[a]);
}`],
  ['STORE', 2, 'addr, src', 'memory[addr] = src', 'Write src into the cell at addr.', `function STORE(addr, src) {
  writeMem(read(addr), read(src));
}`],
  ['ADD', 2, 'dst, src', 'dst = dst + src', 'Add src to dst and set the flags.', `function ADD(dst, src) {
  const r = read(dst) + read(src);
  write(dst, r);
  setFlags(r);
}`],
  ['SUB', 2, 'dst, src', 'dst = dst − src', 'Subtract src from dst and set the flags.', `function SUB(dst, src) {
  const r = read(dst) - read(src);
  write(dst, r);
  setFlags(r);
}`],
  ['MUL', 2, 'dst, src', 'dst = dst × src', 'Multiply dst by src and set the flags.', `function MUL(dst, src) {
  const r = read(dst) * read(src);
  write(dst, r);
  setFlags(r);
}`],
  ['DIV', 2, 'dst, src', 'dst = dst ÷ src (integer)', 'Integer division. With the ÷0 guard on, dividing by zero halts the CPU; off, it yields 0.', `function DIV(dst, src) {
  const d = read(src);
  if (d === 0) {
    if (S.divZero) throw new Error('Division by zero');
    write(dst, 0);
    setFlags(0);
    return;
  }
  const r = Math.trunc(read(dst) / d);
  write(dst, r);
  setFlags(r);
}`],
  ['MOD', 2, 'dst, src', 'dst = dst mod src', 'Remainder of dst ÷ src. Modulo by zero follows the ÷0 guard.', `function MOD(dst, src) {
  const d = read(src);
  if (d === 0) {
    if (S.divZero) throw new Error('Modulo by zero');
    write(dst, 0);
    setFlags(0);
    return;
  }
  const r = read(dst) % d;
  write(dst, r);
  setFlags(r);
}`],
  ['INC', 1, 'dst', 'dst = dst + 1', 'Add one and set the flags.', `function INC(dst) {
  const r = read(dst) + 1;
  write(dst, r);
  setFlags(r);
}`],
  ['DEC', 1, 'dst', 'dst = dst − 1', 'Subtract one and set the flags.', `function DEC(dst) {
  const r = read(dst) - 1;
  write(dst, r);
  setFlags(r);
}`],
  ['AND', 2, 'dst, src', 'dst = dst & src', 'Bitwise AND. Sets the flags.', `function AND(dst, src) {
  const r = read(dst) & read(src);
  write(dst, r);
  setFlags(r);
}`],
  ['OR', 2, 'dst, src', 'dst = dst | src', 'Bitwise OR. Sets the flags.', `function OR(dst, src) {
  const r = read(dst) | read(src);
  write(dst, r);
  setFlags(r);
}`],
  ['XOR', 2, 'dst, src', 'dst = dst ^ src', 'Bitwise exclusive OR. Sets the flags.', `function XOR(dst, src) {
  const r = read(dst) ^ read(src);
  write(dst, r);
  setFlags(r);
}`],
  ['NOT', 1, 'dst', 'dst = ~dst', 'Bitwise complement. Sets the flags.', `function NOT(dst) {
  const r = ~read(dst);
  write(dst, r);
  setFlags(r);
}`],
  ['SHL', 2, 'dst, n', 'dst = dst << n', 'Shift left by n bits. Sets the flags.', `function SHL(dst, n) {
  const r = read(dst) << read(n);
  write(dst, r);
  setFlags(r);
}`],
  ['SHR', 2, 'dst, n', 'dst = dst >> n', 'Arithmetic shift right by n bits. Sets the flags.', `function SHR(dst, n) {
  const r = read(dst) >> read(n);
  write(dst, r);
  setFlags(r);
}`],
  ['CMP', 2, 'a, b', 'flags = a − b', 'Set the flags from (a − b) without writing anything.', `function CMP(a, b) {
  setFlags(read(a) - read(b));
}`],
  ['JMP', 1, 'label', 'pc = target', 'Jump unconditionally.', `function JMP(target) {
  return jump(target);
}`],
  ['JEQ', 1, 'label', 'if ZF: pc = target', 'Jump if the zero flag is set (equal, or a zero result). Alias: JZ.', `function JEQ(target) {
  if (cpu.flags.ZF) return jump(target);
}`],
  ['JNE', 1, 'label', 'if !ZF: pc = target', 'Jump if the zero flag is clear. Alias: JNZ.', `function JNE(target) {
  if (!cpu.flags.ZF) return jump(target);
}`],
  ['JLT', 1, 'label', 'if SF: pc = target', 'Jump if the sign flag is set (less than).', `function JLT(target) {
  if (cpu.flags.SF) return jump(target);
}`],
  ['JGE', 1, 'label', 'if !SF: pc = target', 'Jump if the sign flag is clear (greater or equal).', `function JGE(target) {
  if (!cpu.flags.SF) return jump(target);
}`],
  ['JGT', 1, 'label', 'if !SF && !ZF: pc = target', 'Jump if the result was positive and non-zero.', `function JGT(target) {
  if (!cpu.flags.SF && !cpu.flags.ZF) return jump(target);
}`],
  ['JLE', 1, 'label', 'if SF || ZF: pc = target', 'Jump if the result was negative or zero.', `function JLE(target) {
  if (cpu.flags.SF || cpu.flags.ZF) return jump(target);
}`],
  ['PUSH', 1, 'src', 'memory[sp] = src; sp−−', 'Push a value onto the stack. The stack grows down from 0x3FF.', `function PUSH(src) {
  if (cpu.sp < 0) throw new Error('Stack overflow');
  writeMem(cpu.sp, read(src));
  cpu.sp--;
}`],
  ['POP', 1, 'dst', 'sp++; dst = memory[sp]', 'Pop the top of the stack into dst.', `function POP(dst) {
  if (cpu.sp + 1 >= MEM_SIZE) throw new Error('Stack underflow');
  cpu.sp++;
  write(dst, cpu.memory[cpu.sp]);
}`],
  ['CALL', 1, 'label', 'push pc + 1; pc = target', 'Push the return address and jump into a subroutine.', `function CALL(target) {
  if (cpu.sp < 0) throw new Error('Stack overflow on CALL');
  writeMem(cpu.sp, cpu.pc + 1);
  cpu.sp--;
  return jump(target);
}`],
  ['RET', 0, '', 'pc = pop()', 'Return to the address on top of the stack.', `function RET() {
  if (cpu.sp + 1 >= MEM_SIZE) throw new Error('Stack underflow on RET');
  cpu.sp++;
  cpu.pc = cpu.memory[cpu.sp];
  return true;
}`],
  ['OUT', 1, 'src', 'print src as a number', 'Print src as a decimal integer on its own line.', `function OUT(src) {
  print(read(src));
}`],
  ['OUTC', 1, 'src', 'print src as a character', 'Print the ASCII character for src. 10 is a newline; 0 prints nothing.', `function OUTC(src) {
  printChar(read(src));
}`],
  ['IN', 1, 'dst', 'dst = a value typed into the TTY', 'Pause until a value is entered in the TTY, then store it in dst.', `function IN(dst) {
  requestInput(dst);
}`],
  ['NOP', 0, '', 'do nothing', 'Do nothing and move on.', `function NOP() {
}`],
  ['HLT', 0, '', 'halt the CPU', 'Stop execution.', `function HLT() {
  halt();
  return true;
}`],
];
for (const [name, arity, syntax, summary, note, src] of OP_TABLE) {
  const fn = compileOp(src);
  OPS[name] = { name, arity, syntax, summary, note, src, fn, original: fn };
}
OPS.JZ = OPS.JEQ;
OPS.JNZ = OPS.JNE;
const ALIASES = { JZ: 'JEQ', JNZ: 'JNE' };
const canonical = name => ALIASES[name] || name;
const PATCHED = new Set();
const SRC_CACHE = new WeakMap();

function fnSource(fn) {
  let s = SRC_CACHE.get(fn);
  if (s === undefined) {
    const lines = String(fn).split('\n');
    let indent = Infinity;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      indent = Math.min(indent, lines[i].match(/^\s*/)[0].length);
    }
    if (indent === Infinity) indent = 0;
    s = lines.map((l, i) => i === 0 ? l : l.slice(indent)).join('\n');
    SRC_CACHE.set(fn, s);
  }
  return s;
}
function patchOp(name, code) {
  code = String(code).trim();
  let fn;
  try { fn = compileOp(code); } catch (e) { return { ok: false, error: 'syntax: ' + e.message }; }
  if (typeof fn !== 'function') return { ok: false, error: 'the code must evaluate to a function, e.g. function ADD(dst, src) { … }' };
  const def = OPS[name];
  def.fn = fn;
  if (code === def.src) PATCHED.delete(name); else PATCHED.add(name);
  return { ok: true };
}
function resetOp(name) { const def = OPS[name]; def.fn = def.original; PATCHED.delete(name); }

/* ---------- §4 RAM beep (Web Audio) -------------------------------------- */
const BASE_MODES = ['off', 'sine', 'square', 'triangle', 'sawtooth'];
const audio = {
  ctx: null, last: 0, buffer: null, data: null, decoding: null,
  modes() { return audio.data ? BASE_MODES.concat('custom') : BASE_MODES; },
  decode() {
    if (audio.buffer || !audio.data || audio.decoding || !audio.ensure()) return audio.decoding || Promise.resolve();
    const data = audio.data;
    audio.decoding = fetch(data).then(r => r.arrayBuffer()).then(b => audio.ctx.decodeAudioData(b))
      .then(buf => { if (audio.data === data) audio.buffer = buf; })
      .catch(() => {})
      .finally(() => { audio.decoding = null; });
    return audio.decoding;
  },
  ensure() {
    if (audio.ctx) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    audio.ctx = new Ctx();
    return true;
  },
  gain() { return S.muted ? 0 : Math.pow(S.volume / 100, 1.6) * 0.45; },
  beep(value) {
    if (S.sound === 'off' || !audio.ctx) return;
    const g = audio.gain();
    if (g <= 0) return;
    const now = performance.now();
    if (now - audio.last < 28) return;
    audio.last = now;
    const freq = S.pitch * Math.pow(2, (value & 0xff) / 85);
    const ctx = audio.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (S.sound === 'custom' && !audio.buffer) { audio.decode(); return; }
    const t0 = ctx.currentTime + 0.005;
    const amp = ctx.createGain();
    amp.connect(ctx.destination);
    if (S.sound === 'custom') {
      const src = ctx.createBufferSource();
      src.buffer = audio.buffer;
      src.playbackRate.value = freq / S.pitch;
      const dur = clamp(audio.buffer.duration / src.playbackRate.value, 0.03, 0.4);
      amp.gain.setValueAtTime(g, t0);
      amp.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
      src.connect(amp);
      src.start(t0);
      src.stop(t0 + dur + 0.01);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = S.sound;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(g, t0 + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.03);
    osc.connect(amp);
    osc.start(t0);
    osc.stop(t0 + 0.035);
  },
  async loadSample(dataUrl) {
    audio.data = dataUrl || null;
    audio.buffer = null;
    if (!dataUrl) return false;
    await audio.decode();
    return !!audio.buffer;
  },
};

/* ---------- §5 TTY ------------------------------------------------------- */
const tty = {
  el: byId('console'), pending: false, MAX: 4000,
  line(markup, cls) {
    tty.el.append(h('span', { class: cls || null, html: markup }), document.createTextNode('\n'));
    tty.trim();
    tty.pending = true;
  },
  char(code) {
    if (code === 0) return;
    const ch = String.fromCharCode(code);
    const last = tty.el.lastChild;
    if (last && last.nodeType === 3 && last.data.length < 16384) last.appendData(ch);
    else tty.el.append(document.createTextNode(ch));
    tty.trim();
    tty.pending = true;
  },
  trim() { while (tty.el.childNodes.length > tty.MAX) tty.el.removeChild(tty.el.firstChild); },
  clear() { tty.el.textContent = ''; },
  flush() { tty.pending = false; }, /* the reversed flex column keeps the newest line in view */
};

/* ---------- §6 runner ---------------------------------------------------- */
const run = { timer: null, sync: false, paused: false, stale: false, skipBp: false, speed: 180, stepping: false };
let breakpoints = new Set();
let bpVersion = 0;
let lintErrors = new Map();
let lintVersion = 0;
const ui = {};
['btnRunLabel', 'statusPill', 'statusText', 'nowExec', 'nowOp', 'nowVals', 'cycleCount', 'ipsCounter', 'btnRun', 'btnStep', 'btnPause', 'btnReset',
 'ttyInRow', 'ttyInput', 'ttyMode', 'ttyDot', 'regs', 'nowCard', 'nowName', 'nowPatched', 'nowSummary', 'nowArgs', 'nowCode',
 'cpuOps', 'refScroll', 'opsCount', 'baseToggle', 'speedRange', 'speedNum', 'speedUnit', 'clockCtrl', 'footPins', 'toast', 'toastText', 'tip']
  .forEach(id => { ui[id] = byId(id); });

function setStatus(text, kind) {
  ui.statusText.textContent = text;
  ui.statusPill.dataset.kind = kind || 'ready';
  const label = run.paused && !cpu.halted && cycles > 0 ? 'Resume' : 'Run';
  if (ui.btnRunLabel.textContent !== label) ui.btnRunLabel.textContent = label;
}
function setLeds(live) { $$('[data-led]').forEach(l => l.classList.toggle('live', live)); }
function setRunButtons(running) {
  ui.btnRun.disabled = running;
  ui.btnStep.disabled = running;
  ui.btnPause.disabled = !running;
}
const watchable = () => !run.timer || run.speed >= 60;

function parseProgram() {
  const r = assemble(editors.asm.el.value);
  program = r.program;
  labels = r.labels;
  run.stale = false;
  snapBreakpoints();
}
function snapBreakpoints() {
  if (!breakpoints.size || !program.length) return;
  const lines = new Set(program.map(p => p.line));
  const next = new Set();
  let changed = false;
  for (const bp of breakpoints) {
    if (lines.has(bp)) { next.add(bp); continue; }
    const t = program.find(p => p.line > bp);
    if (t) next.add(t.line);
    changed = true;
  }
  if (changed) { breakpoints = next; bpVersion++; }
}

function execute(skipRender) {
  if (cpu.halted) { onHalt(); return; }
  if (cpu.waitingFor) return;
  const ins = program[cpu.pc]; /* undefined when PC is outside the program */
  if (ins === undefined) {
    cpu.halted = true;
    setStatus('HALTED · PC OUT OF RANGE', 'warn');
    onHalt();
    return;
  }
  if (breakpoints.size !== 0 && (run.timer || run.sync) && breakpoints.has(ins.line) && !run.skipBp) { pause('PAUSED · BREAKPOINT'); return; }
  if (run.skipBp) run.skipBp = false;
  if (!skipRender) {
    regSnapshot = { PC: cpu.pc, SP: cpu.sp, R1: cpu.registers.R1, R2: cpu.registers.R2, R3: cpu.registers.R3, R4: cpu.registers.R4 };
    recentWrite = -1;
  }
  try {
    const def = ins.op;
    if (def === null) throw new Error(`Unknown instruction "${ins.tokens[0]}"`);
    if (!def.fn(ins.a, ins.b)) cpu.pc++;
    cycles++;
  } catch (e) { crash(ins, e); }
  if (!skipRender) renderAll();
}

function runButton() {
  const fresh = cpu.halted || cycles === 0;
  if (!fresh) { resume(); return; }
  if (S.strict) {
    const errs = lintText(editors.asm.el.value);
    if (errs.size) {
      const [line, msg] = [...errs.entries()].sort((a, b) => a[0] - b[0])[0];
      tty.line(`× strict run — fix ${errs.size} syntax error${errs.size === 1 ? '' : 's'} first · line ${line + 1}: ${esc(msg)}`, 'err');
      setStatus('SYNTAX', 'err');
      applyLint(errs);
      tty.flush();
      return;
    }
  }
  parseProgram();
  if (!program.length) { reportEmpty(); return; }
  startExecution();
}
function reportEmpty() {
  tty.line('<span class="dim">nothing to run — write some code or load an example</span>');
  setStatus('READY', 'ready');
  setLeds(false);
  tty.flush();
}
function startExecution() {
  resetCPU(true);
  setRunButtons(true);
  run.paused = false;
  run.skipBp = false;
  setStatus('RUNNING', 'run');
  setLeds(true);
  startTimer();
}
function resume() {
  setRunButtons(true);
  run.paused = false;
  run.skipBp = !!(program[cpu.pc] && breakpoints.has(program[cpu.pc].line));
  setStatus('RUNNING', 'run');
  setLeds(true);
  startTimer();
}
function stopTimer() { if (run.timer) { clearInterval(run.timer); run.timer = null; } }
function crash(ins, e) {
  tty.line(`× line ${ins.line + 1}: ${esc(e.message)}`, 'err');
  toast(`Crashed on line ${ins.line + 1} — ${e.message}`, 'err');
  cpu.halted = true;
  setStatus('CRASHED', 'err');
  onHalt();
}
/* Runs up to `max` instructions without rendering, for at most `budget` ms.
   Halts, unknown instructions and breakpoints take the full execute() path. */
function burst(max, budget) {
  const t0 = performance.now();
  let n = 0, ins = null;
  try {
    while (n < max && !cpu.halted && !run.paused && !cpu.waitingFor) {
      ins = program[cpu.pc];
      if (ins === undefined || ins.op === null || run.skipBp || (breakpoints.size !== 0 && breakpoints.has(ins.line))) execute(true);
      else { if (!ins.op.fn(ins.a, ins.b)) cpu.pc++; cycles++; }
      if ((++n & 63) === 0 && performance.now() - t0 >= budget) break;
    }
  } catch (e) { crash(ins, e); }
  return n;
}
function startTimer() {
  stopTimer();
  const speed = run.speed;
  const busy = () => cpu.halted || run.paused || cpu.waitingFor;
  if (speed === 0) {
    /* Instant: run synchronously for up to 200 ms, then fall back to 8 ms bursts
       so an endless loop keeps the page responsive. */
    run.sync = true;
    burst(Infinity, 200);
    run.sync = false;
    renderAll();
    if (busy()) return;
    run.timer = setInterval(() => {
      if (busy()) return;
      burst(Infinity, 8);
      scheduleRender();
    }, 0);
    return;
  }
  if (speed >= 16) { run.timer = setInterval(() => execute(), speed); return; }
  /* Fast clocks: batch instructions per 60 fps frame and render once. */
  const perFrame = Math.max(1, Math.round(16 / speed));
  run.timer = setInterval(() => {
    if (busy()) return;
    if (burst(perFrame, 10)) scheduleRender();
  }, 16);
}
function stepExecution() {
  if (run.timer || run.sync) { pause('PAUSED · STEPPING'); return; }
  if (cpu.halted) resetCPU(true);
  if (!program.length || (run.stale && cycles === 0)) parseProgram();
  if (!program.length) { reportEmpty(); return; }
  execute();
  if (!cpu.halted) { run.paused = true; setStatus('PAUSED · STEPPING', 'warn'); }
}
function pause(text) {
  stopTimer();
  cpu.wasRunning = false;
  ips.reset();
  setRunButtons(false);
  run.paused = true;
  setStatus(text || 'PAUSED', 'warn');
  setLeds(false);
  renderAll();
}
function onHalt() {
  stopTimer();
  setRunButtons(false);
  run.paused = false;
  ips.reset();
  setLeds(false);
  if (cpu.waitingFor) { cpu.waitingFor = null; cpu.wasRunning = false; setInputRow(false); }
}
function resetCPU(silent) {
  stopTimer();
  Object.assign(cpu, freshCPU());
  regSnapshot = { PC: 0, SP: MEM_SIZE - 1, R1: 0, R2: 0, R3: 0, R4: 0 };
  cycles = 0;
  recentWrite = -1;
  run.paused = false;
  run.skipBp = false;
  ips.reset();
  tty.clear();
  setInputRow(false);
  parseProgram();
  setRunButtons(false);
  setStatus('READY', 'ready');
  setLeds(false);
  if (!silent) renderAll();
}

/* TTY input for IN */
function setInputRow(active, dst) {
  ui.ttyInRow.classList.toggle('active', active);
  ui.ttyInput.disabled = !active;
  ui.ttyInput.value = '';
  ui.ttyInput.classList.remove('invalid');
  ui.ttyInput.placeholder = active ? `IN → ${dst} · a number, 0x…, 0b… or a character, then Return` : 'idle — opens during IN';
  ui.ttyMode.textContent = active ? 'INPUT' : 'I/O';
  ui.ttyMode.classList.toggle('input', active);
  ui.ttyDot.classList.toggle('awaiting', active);
}
function requestInput(dst) {
  cpu.waitingFor = dst;
  cpu.wasRunning = !!run.timer || run.sync;
  stopTimer();
  ips.reset(); /* the CPU is idle while it waits, so freq reads 0 */
  setInputRow(true, dst);
  setTimeout(() => ui.ttyInput.focus(), 0);
  tty.line(`<span class="acc">› awaiting input → ${dst}</span>`);
  setStatus('AWAITING INPUT', 'input');
  setLeds(false);
  renderAll();
}
function parseInputValue(s) {
  const t = String(s).trim();
  if (!t) return null;
  if (/^-?0x[0-9a-f]+$/i.test(t)) return { value: parseInt(t, 16), echo: t };
  if (/^-?0b[01]+$/i.test(t)) return { value: parseInt(t.replace(/^(-?)0b/i, '$1'), 2), echo: t };
  if (/^-?\d+$/.test(t)) return { value: parseInt(t, 10), echo: t };
  if (/^'.'$/.test(t)) return { value: t.charCodeAt(1), echo: `${t} (${t.charCodeAt(1)})` };
  if (t.length === 1) return { value: t.charCodeAt(0), echo: `'${t}' (${t.charCodeAt(0)})` };
  return null;
}
function provideInput() {
  if (!cpu.waitingFor) return;
  const parsed = parseInputValue(ui.ttyInput.value);
  if (!parsed) {
    ui.ttyInput.classList.add('invalid');
    setTimeout(() => ui.ttyInput.classList.remove('invalid'), 400);
    tty.line('× enter a number (42), hex (0x2A), binary (0b101010) or a single character', 'err');
    tty.flush();
    return;
  }
  const dst = cpu.waitingFor;
  write(dst, parsed.value | 0);
  tty.line(`<span class="dim">  ${esc(parsed.echo)} → ${dst}</span>`);
  cpu.waitingFor = null;
  const wasRunning = cpu.wasRunning;
  cpu.wasRunning = false;
  setInputRow(false);
  if (wasRunning) { setStatus('RUNNING', 'run'); setLeds(true); startTimer(); }
  else { setStatus('PAUSED', 'warn'); renderAll(); }
}
ui.ttyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); provideInput(); } });

/* clock */
const ips = {
  hist: [],
  reset() { ips.hist.length = 0; },
  sample() {
    const now = performance.now();
    ips.hist.push({ t: now, c: cycles });
    while (ips.hist.length && now - ips.hist[0].t >= 700) ips.hist.shift();
    if (ips.hist.length < 2) return 0;
    const a = ips.hist[0], b = ips.hist[ips.hist.length - 1];
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.c - a.c) / dt : 0;
  },
  format(v) {
    if (v < 1) return '0';
    if (v < 1000) return Math.round(v) + ' Hz';
    if (v < 1e6) return (v / 1000).toFixed(1) + ' kHz';
    return (v / 1e6).toFixed(2) + ' MHz';
  },
};
function applySpeed(ms) {
  run.speed = ms;
  document.body.dataset.pace = ms >= 60 ? 'slow' : 'fast';
  if (run.timer) startTimer();
}
function setTabClock(tab, ms) {
  ms = Math.max(0, parseFloat(ms) || 0);
  if (S.clockSep) {
    S.tabClocks[tab] = ms;
    if (tab === editorTabs.current) applySpeed(ms);
  } else {
    for (const t in S.tabClocks) S.tabClocks[t] = ms;
    applySpeed(ms);
  }
  saveSettings();
  syncClockUI();
}
/* Clock sliders are logarithmic: position 0 is instant, 1–1000 spans 1 ms to 2 s,
   so the fast end gets as much travel as the slow end. Typed values can go anywhere. */
const CLOCK_MAX = 2000;
function sliderToMs(pos) {
  pos = +pos;
  if (pos <= 0) return 0;
  const ms = Math.pow(CLOCK_MAX, pos / 1000);
  return ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms);
}
const msToSlider = ms => ms <= 0 ? 0 : clamp(Math.round(1000 * Math.log(Math.max(ms, 1)) / Math.log(CLOCK_MAX)), 1, 1000);
const CLOCK_FIELDS = { asm: ['clockAsmRange', 'clockAsmNum'], host: ['clockHostRange', 'clockHostNum'], hybrid: ['clockHybridRange', 'clockHybridNum'] };
function setClockInputs(range, num, v) {
  if (document.activeElement !== range) range.value = msToSlider(v);
  if (document.activeElement !== num) num.value = fmtNum(v);
}
function syncClockUI() {
  const active = editorTabs.current;
  for (const t in CLOCK_FIELDS) {
    const [r, n] = CLOCK_FIELDS[t].map(byId);
    r.closest('.clock-field').hidden = !S.clockSep;
    setClockInputs(r, n, S.tabClocks[t]);
    const unit = n.nextElementSibling, u = S.tabClocks[t] === 0 ? 'instant' : 'ms';
    if (unit && unit.textContent !== u) unit.textContent = u;
  }
  const v = S.clockSep ? S.tabClocks[active] : run.speed;
  setClockInputs(ui.speedRange, ui.speedNum, v);
  ui.speedUnit.textContent = v === 0 ? 'instant' : 'ms';
  ui.clockCtrl.classList.toggle('instant', v === 0);
  ui.clockCtrl.classList.toggle('slow', v > 500 && v <= 2000);
  ui.clockCtrl.classList.toggle('deep', v > 2000);
  ui.clockCtrl.hidden = !S.pins.clock;
  syncControls('defaultClock');
}
function wireClockInputs() {
  for (const t in CLOCK_FIELDS) {
    const [r, n] = CLOCK_FIELDS[t].map(byId);
    r.addEventListener('input', () => setTabClock(t, sliderToMs(r.value)));
    n.addEventListener('input', () => setTabClock(t, n.value));
  }
  ui.speedRange.addEventListener('input', () => setTabClock(editorTabs.current, sliderToMs(ui.speedRange.value)));
  ui.speedNum.addEventListener('input', () => setTabClock(editorTabs.current, ui.speedNum.value));
}

/* ---------- §7 rendering ------------------------------------------------- */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderAll(); });
}
let lastCycles = -1, lastIps = null;
function renderAll() {
  renderRegs();
  renderFlags();
  renderMemory();
  renderGutter();
  renderNow();
  if (cycles !== lastCycles) { ui.cycleCount.textContent = String(cycles); lastCycles = cycles; }
  const f = ips.format(ips.sample());
  if (f !== lastIps) { ui.ipsCounter.textContent = f; lastIps = f; }
  tty.flush();
}

/* registers */
const regCells = {};
let editingReg = null;
const REG_ORDER = ['PC', 'SP', 'R1', 'R2', 'R3', 'R4'];
const regValue = n => n === 'PC' ? cpu.pc : n === 'SP' ? cpu.sp : cpu.registers[n];
function buildRegs() {
  for (const name of REG_ORDER) {
    const v = h('div', { class: 'reg-v' });
    const x = h('div', { class: 'reg-h' });
    const card = h('div', { class: 'reg' + (name === 'PC' || name === 'SP' ? ' special' : ''), 'data-tip': `${name} — click to edit`, role: 'button', tabindex: '0' },
      h('div', { class: 'reg-k', text: name }), v, x);
    card.addEventListener('click', () => editRegister(name));
    card.addEventListener('keydown', e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editRegister(name); } });
    ui.regs.append(card);
    regCells[name] = { card, v, x, shown: null, mode: null };
  }
}
/* Change pulse on a register value. Only when the run is watchable (stepping or
   a clock of 60 ms and up): at faster clocks it would just strobe. */
function flash(el) {
  if (!watchable()) return;
  const next = el.classList.contains('fa') ? 'fb' : 'fa';
  el.classList.remove('fa', 'fb');
  el.classList.add(next);
}
function renderRegs() {
  const hex = S.base === 'hex';
  for (const name of REG_ORDER) {
    if (name === editingReg) continue;
    const c = regCells[name];
    const val = regValue(name);
    if (val !== c.shown || S.base !== c.mode) {
      c.v.textContent = hex ? fmtHex2(val) : String(val);
      c.x.textContent = hex ? String(val) : '0x' + fmtHex2(val);
      c.shown = val; c.mode = S.base;
    }
    if (regSnapshot[name] !== val) { if (name !== 'PC') flash(c.v); regSnapshot[name] = val; }
  }
}
function parseEditValue(s) {
  const t = String(s).trim();
  if (!t) return NaN;
  if (/^-?0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  if (/^-?0b[01]+$/i.test(t)) return parseInt(t.replace(/^(-?)0b/i, '$1'), 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return NaN;
}
function editRegister(name) {
  if (editingReg) return;
  editingReg = name;
  const c = regCells[name];
  const val = regValue(name);
  const input = h('input', { type: 'text', class: 'reg-edit', value: S.base === 'hex' ? fmtHex2(val) : String(val), 'aria-label': 'edit ' + name });
  c.v.textContent = '';
  c.v.append(input);
  input.focus(); input.select();
  input.addEventListener('input', () => {
    const p = parseEditValue(input.value);
    if (!Number.isNaN(p)) c.x.textContent = S.base === 'hex' ? String(p | 0) : '0x' + fmtHex2(p | 0);
  });
  let done = false;
  const finish = commit => {
    if (done) return; done = true;
    if (commit) {
      const p = parseEditValue(input.value);
      if (!Number.isNaN(p)) writeReg(name, p | 0);
    }
    editingReg = null;
    c.shown = null;
    renderRegs();
    renderMemory(true);
    renderNow();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

/* flags */
const flagEls = {};
const flagShown = { ZF: null, SF: null };
$$('#flags .flag').forEach(b => {
  const f = b.dataset.flag;
  flagEls[f] = b;
  b.addEventListener('click', () => { cpu.flags[f] = cpu.flags[f] ? 0 : 1; renderFlags(); renderNow(); });
});
function renderFlags() {
  for (const f of ['ZF', 'SF']) {
    const v = cpu.flags[f];
    if (v === flagShown[f]) continue;
    flagShown[f] = v;
    flagEls[f].querySelector('b').textContent = v;
    flagEls[f].classList.toggle('set', v === 1);
    flagEls[f].setAttribute('aria-pressed', v === 1);
  }
}

/* memory: one canvas instead of 1,088 elements. Only cells whose value or
   state changed are redrawn. Hover, click-to-edit, tooltips and keyboard
   navigation (arrow keys, Page Up/Down, Home/End, Enter or a digit to edit)
   are layered on top. */
const LBL_W = 34, GAP = 2, HEAD_H = 16, ROW_H = 18, PITCH = ROW_H + GAP;
const ST_NZ = 1, ST_STACK = 2, ST_SP = 4, ST_RECENT = 8, ST_HOVER = 16, ST_FOCUS = 32;
const mem = {
  canvas: null, ctx: null, scroll: null, live: null,
  W: 0, dpr: 1, cw: 0, fs: 10, mode: null, colors: null,
  shownV: new Float64Array(MEM_SIZE), shownS: new Uint8Array(MEM_SIZE),
  hover: -1, focus: -1, ring: false, editing: null, tipTimer: null,
};
const cellX = c => LBL_W + GAP + c * (mem.cw + GAP);
const cellY = r => HEAD_H + GAP + r * PITCH;
function memColors() {
  const cs = getComputedStyle(mem.canvas), v = n => cs.getPropertyValue(n).trim();
  return { cell: v('--cell'), nz: v('--cell-nz'), stack: v('--warn-soft'), text: v('--text'), text3: v('--text-3'), warn: v('--warn'), warnInk: v('--warn-ink'), accent: v('--accent'), accentInk: v('--accent-ink'), mono: cs.fontFamily };
}
function buildMemory() {
  mem.canvas = byId('memCanvas');
  mem.ctx = mem.canvas.getContext('2d', { alpha: true });
  mem.scroll = byId('memScroll');
  mem.live = byId('memLive');
  const c = mem.canvas;
  c.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') memHover(memHit(e.offsetX, e.offsetY)); });
  c.addEventListener('pointerleave', () => memHover(-1));
  c.addEventListener('click', e => { const i = memHit(e.offsetX, e.offsetY); if (i >= 0) { memFocus(i, false); editMemory(i); } });
  c.addEventListener('focus', () => { let ring = false; try { ring = c.matches(':focus-visible'); } catch (err) {} memFocus(mem.focus < 0 ? 0 : mem.focus, ring); });
  c.addEventListener('blur', () => { mem.ring = false; memRedraw(mem.focus); });
  c.addEventListener('keydown', memKey);
  mem.scroll.addEventListener('scroll', () => memHover(-1), { passive: true });
}
/* Size the canvas to its box (device pixels) and redraw everything. */
function fitMemory() {
  if (!mem.canvas || machineTabs.current !== 'memory') { mem.W = 0; return; }
  const W = mem.scroll.clientWidth - 12;
  if (W <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const H = HEAD_H + GAP + 32 * PITCH - GAP;
  mem.W = W; mem.dpr = dpr;
  mem.canvas.width = Math.round(W * dpr); mem.canvas.height = Math.round(H * dpr);
  mem.canvas.style.width = W + 'px'; mem.canvas.style.height = H + 'px';
  mem.cw = (W - LBL_W - 32 * GAP) / 32;
  mem.mode = S.base;
  mem.fs = clamp(Math.floor(mem.cw / ((S.base === 'hex' ? 2 : 3) * 0.66 + 0.5)), 7, 11);
  mem.colors = memColors();
  const g = mem.ctx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 9px ${mem.colors.mono}`; g.fillStyle = mem.colors.text3;
  const sparse = mem.cw < 13; /* narrow columns: label every fourth one */
  for (let c = 0; c < 32; c++) if (!sparse || c % 4 === 0) g.fillText(c.toString(16).toUpperCase().padStart(2, '0'), cellX(c) + mem.cw / 2, HEAD_H / 2 + 1);
  g.textAlign = 'right';
  for (let r = 0; r < 32; r++) g.fillText((r * 32).toString(16).toUpperCase().padStart(3, '0'), LBL_W - 6, cellY(r) + ROW_H / 2 + 0.5);
  g.textAlign = 'center';
  mem.shownV.fill(NaN);
  renderMemory(true);
}
function memState(i) {
  let st = 0;
  if (cpu.memory[i] !== 0) st |= ST_NZ;
  if (i > cpu.sp) st |= ST_STACK;
  if (i === cpu.sp) st |= ST_SP;
  if (i === recentWrite) st |= ST_RECENT;
  if (i === mem.hover) st |= ST_HOVER;
  if (i === mem.focus && mem.ring) st |= ST_FOCUS;
  return st;
}
function memDrawCell(i, v, st) {
  const g = mem.ctx, k = mem.colors, x = cellX(i & 31), y = cellY(i >> 5), w = mem.cw;
  g.clearRect(x - 0.5, y - 0.5, w + 1, ROW_H + 1);
  g.fillStyle = st & ST_RECENT ? k.accent : st & ST_STACK ? k.stack : st & ST_NZ ? k.nz : k.cell;
  g.beginPath(); g.roundRect ? g.roundRect(x, y, w, ROW_H, 4) : g.rect(x, y, w, ROW_H); g.fill();
  const ring = st & ST_FOCUS ? 2 : st & (ST_HOVER | ST_SP) ? 1.5 : 0;
  if (ring) {
    g.lineWidth = ring; g.strokeStyle = st & (ST_FOCUS | ST_HOVER) ? k.accent : k.warn;
    g.beginPath(); g.roundRect ? g.roundRect(x + ring / 2, y + ring / 2, w - ring, ROW_H - ring, 4 - ring / 2) : g.rect(x + ring / 2, y + ring / 2, w - ring, ROW_H - ring); g.stroke();
  }
  const b = v & 0xff;
  g.font = `${st & ST_NZ ? 600 : 500} ${mem.fs}px ${k.mono}`;
  g.fillStyle = st & ST_RECENT ? k.accentInk : (st & ST_STACK) && (st & ST_NZ) ? k.warnInk : st & ST_NZ ? k.text : k.text3;
  g.fillText(S.base === 'hex' ? fmtHex2(b) : String(b), x + w / 2, y + ROW_H / 2 + 0.5);
}
function renderMemory(force) {
  if (machineTabs.current !== 'memory' && !force) return;
  if (!mem.W || mem.mode !== S.base) { fitMemory(); return; }
  const m = cpu.memory, sv = mem.shownV, ss = mem.shownS;
  for (let i = 0; i < MEM_SIZE; i++) {
    if (i === mem.editing) continue;
    const v = m[i], st = memState(i);
    if (v !== sv[i] || st !== ss[i]) { memDrawCell(i, v, st); sv[i] = v; ss[i] = st; }
  }
}
function memRedraw(i) {
  if (i < 0 || !mem.W || i === mem.editing) return;
  const v = cpu.memory[i], st = memState(i);
  memDrawCell(i, v, st); mem.shownV[i] = v; mem.shownS[i] = st;
}
function memHit(x, y) {
  const c = Math.floor((x - LBL_W - GAP) / (mem.cw + GAP)), r = Math.floor((y - HEAD_H - GAP) / PITCH);
  if (c < 0 || c > 31 || r < 0 || r > 31 || x - cellX(c) > mem.cw || y - cellY(r) > ROW_H) return -1;
  return r * 32 + c;
}
function memCellRect(i) {
  const b = mem.canvas.getBoundingClientRect();
  return { left: b.left + cellX(i & 31), top: b.top + cellY(i >> 5), width: mem.cw, height: ROW_H, right: b.left + cellX(i & 31) + mem.cw, bottom: b.top + cellY(i >> 5) + ROW_H };
}
function memTip(i) {
  const v = cpu.memory[i], b = v & 0xff;
  let s = `addr ${i} · ${fmtAddr(i)} · ${v}`;
  if (v !== b) s += ` (low byte ${b})`;
  if (i === cpu.sp) s += ' · SP';
  else if (i > cpu.sp) s += ' · stack';
  return s + ' · click to edit';
}
function memHover(i) {
  if (i === mem.hover) return;
  const prev = mem.hover;
  mem.hover = i;
  memRedraw(prev); memRedraw(i);
  clearTimeout(mem.tipTimer);
  if (i < 0) { if (!tip.target) hideTip(); return; }
  if (!S.tips) return;
  const show = () => { if (mem.hover === i) placeTip(memTip(i), memCellRect(i)); };
  if (!tip.el.hidden || performance.now() - tip.lastHide < 350) show(); else mem.tipTimer = setTimeout(show, 450);
}
function memFocus(i, ring) {
  const prev = mem.focus;
  mem.focus = clamp(i, 0, MEM_SIZE - 1); mem.ring = ring;
  memRedraw(prev); memRedraw(mem.focus);
  const y = cellY(mem.focus >> 5), sc = mem.scroll;
  if (y < sc.scrollTop) sc.scrollTop = y - HEAD_H - GAP;
  else if (y + ROW_H > sc.scrollTop + sc.clientHeight - 12) sc.scrollTop = y + ROW_H - sc.clientHeight + 12;
  if (ring) mem.live.textContent = `Address ${fmtAddr(mem.focus)}, value ${cpu.memory[mem.focus]}`;
}
function memKey(e) {
  const i = mem.focus < 0 ? 0 : mem.focus;
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -32, ArrowDown: 32, PageUp: -256, PageDown: 256 };
  if (e.key in moves) { e.preventDefault(); memFocus(i + moves[e.key], true); return; }
  if (e.key === 'Home') { e.preventDefault(); memFocus(e.metaKey || e.ctrlKey ? 0 : i & ~31, true); return; }
  if (e.key === 'End') { e.preventDefault(); memFocus(e.metaKey || e.ctrlKey ? MEM_SIZE - 1 : i | 31, true); return; }
  if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); editMemory(i, null, true); return; }
  if (/^[0-9a-fA-Fx-]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); editMemory(i, e.key, true); }
}
function editMemory(addr, initial, fromKeyboard) {
  if (mem.editing !== null || !mem.W) return;
  mem.editing = addr;
  hideTip();
  const v = cpu.memory[addr] & 0xff;
  const w = Math.max(mem.cw + 8, 34);
  const input = h('input', { type: 'text', class: 'mem-edit', value: initial != null ? initial : S.base === 'hex' ? fmtHex2(v) : String(v), 'aria-label': 'Edit memory at ' + fmtAddr(addr) });
  input.style.left = (mem.canvas.offsetLeft + cellX(addr & 31) + mem.cw / 2 - w / 2) + 'px';
  input.style.top = (mem.canvas.offsetTop + cellY(addr >> 5) - 2) + 'px';
  input.style.width = w + 'px';
  input.style.fontSize = (mem.fs + 1) + 'px';
  mem.scroll.append(input);
  input.focus();
  if (initial == null) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
  let done = false;
  const finish = commit => {
    if (done) return; done = true;
    if (commit) {
      const n = parseEditValue(input.value);
      if (!Number.isNaN(n)) { cpu.memory[addr] = n | 0; recentWrite = addr; }
    }
    mem.editing = null;
    input.remove();
    renderMemory(true);
    renderNow();
    if (fromKeyboard) mem.canvas.focus();
  };
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}
(function watchDpr() {
  matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { fitMemory(); watchDpr(); }, { once: true });
})();

/* gutter + active line */
function activeLine() {
  return (!cpu.halted && !run.stale && program[cpu.pc]) ? program[cpu.pc].line : -1;
}
const clearBreaksBtn = byId('btnClearBreaks');
function renderGutter() {
  editors.asm.render({ bps: breakpoints, bpVersion, errs: lintErrors, lintVersion, active: activeLine() });
  if (clearBreaksBtn.disabled !== !breakpoints.size) clearBreaksBtn.disabled = !breakpoints.size;
}

/* now-executing readout, CPU tab, manual highlight */
let activeCard = null, activeRef = null;
let nowShown = { name: null, summary: null, args: null, code: null, hdr: null, vals: null, idle: null, patched: null };
function setText(el, key, text) { if (nowShown[key] !== text) { el.textContent = text; nowShown[key] = text; } }
function renderNow() {
  const visible = machineTabs.current === 'cpu';
  const idle = cpu.halted || cpu.pc < 0 || cpu.pc >= program.length || !program[cpu.pc];
  if (idle) {
    const label = cpu.halted ? 'halted' : 'idle';
    if (visible) {
      setText(ui.nowName, 'name', '—');
      setText(ui.nowSummary, 'summary', label);
      setText(ui.nowArgs, 'args', '');
      setText(ui.nowCode, 'code', '');
      ui.nowCard.classList.add('idle');
      ui.nowPatched.hidden = true;
    }
    ui.nowExec.classList.remove('live');
    setText(ui.nowOp, 'hdr', label);
    setText(ui.nowVals, 'vals', '');
    highlightOp(null);
    return;
  }
  const [op, a, b] = program[cpu.pc].tokens;
  const name = canonical(op);
  const def = OPS[name];
  let text = op;
  if (a != null) text += ' ' + a;
  if (b != null) text += ', ' + b;
  let vals = '';
  for (const arg of [a, b]) {
    if (arg == null) continue;
    let part;
    try { part = arg + ' → ' + read(arg); } catch (e) { part = arg; }
    vals += (vals ? ' · ' : '') + part;
  }
  if (visible) {
    ui.nowCard.classList.remove('idle');
    setText(ui.nowName, 'name', text);
    setText(ui.nowSummary, 'summary', def ? def.summary : '');
    setText(ui.nowArgs, 'args', vals);
    setText(ui.nowCode, 'code', def ? fnSource(def.fn) : '');
    ui.nowPatched.hidden = !PATCHED.has(name);
  }
  ui.nowExec.classList.add('live');
  setText(ui.nowOp, 'hdr', text);
  setText(ui.nowVals, 'vals', vals);
  highlightOp(watchable() ? name : null);
}
function highlightOp(name) {
  const card = name && opCards[name];
  if (card !== activeCard) {
    if (activeCard) activeCard.classList.remove('active');
    if (card) card.classList.add('active');
    activeCard = card || null;
  }
  const ref = name && refCards[name];
  if (ref !== activeRef) {
    if (activeRef) activeRef.classList.remove('active');
    if (ref) ref.classList.add('active');
    activeRef = ref || null;
  }
}

/* CPU tab — instruction set cards with live patching */
const opCards = {};
let cpuOpsBuilt = false;
/* The patch editor is as tall as its code (4–20 lines), set from the line count
   so nothing has to measure it. */
const fitRows = ta => { ta.rows = clamp(ta.value.split('\n').length, 4, 20); };
function buildCpuOps() {
  if (cpuOpsBuilt) return;
  cpuOpsBuilt = true;
  for (const cat of CATEGORIES) {
    const grid = h('div', { class: 'op-cat-grid' });
    for (const name of cat.ops) {
      const def = OPS[name];
      const ta = h('textarea', { class: 'op-textarea', spellcheck: 'false', 'aria-label': 'code for ' + name });
      ta.value = fnSource(def.fn);
      fitRows(ta);
      const status = h('span', { class: 'op-status' });
      const setStat = (msg, kind) => { status.textContent = msg; status.className = 'op-status' + (kind ? ' ' + kind : ''); if (msg) setTimeout(() => { if (status.textContent === msg) { status.textContent = ''; status.className = 'op-status'; } }, 2600); };
      const apply = () => {
        const r = patchOp(name, ta.value);
        if (r.ok) { setStat(PATCHED.has(name) ? 'patched — live now' : 'original restored', 'ok'); ta.value = fnSource(OPS[name].fn); fitRows(ta); }
        else setStat(r.error, 'err');
        ta.classList.remove('modified');
        card.classList.toggle('patched', PATCHED.has(name));
        nowShown.code = null; renderNow();
      };
      const reset = () => { resetOp(name); ta.value = fnSource(def.original); fitRows(ta); ta.classList.remove('modified'); card.classList.remove('patched'); setStat('original restored', 'ok'); nowShown.code = null; renderNow(); };
      const edit = h('div', { class: 'op-edit' },
        ta,
        h('div', { class: 'op-toolbar' },
          h('button', { class: 'btn sm primary', type: 'button', onclick: apply, 'data-tip': 'Apply this code to the running CPU (⌘↩)' }, 'Apply'),
          h('button', { class: 'btn sm', type: 'button', onclick: reset }, 'Reset'),
          status,
          h('span', { class: 'op-hint', text: '⌘↩ applies · esc closes' }),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => toggleOp(name, false) }, 'Close')));
      edit.addEventListener('click', e => e.stopPropagation());
      const card = h('div', { class: 'op-card', role: 'button', tabindex: '0', 'data-tip': def.summary + ' — click to read or patch the code' },
        h('span', { class: 'op-name', text: name }),
        h('span', { class: 'op-summary', text: def.summary }),
        edit);
      card.addEventListener('click', () => toggleOp(name));
      card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); toggleOp(name); } });
      ta.addEventListener('input', () => { ta.classList.toggle('modified', ta.value !== fnSource(OPS[name].fn)); fitRows(ta); });
      ta.addEventListener('keydown', e => {
        /* ⌘↩ here applies the patch; it must not also reach the global Run shortcut */
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(); }
        else if (e.key === 'Escape') { e.preventDefault(); toggleOp(name, false); }
      });
      card._ta = ta;
      opCards[name] = card;
      grid.append(card);
    }
    ui.cpuOps.append(h('div', { class: 'op-cat' }, h('div', { class: 'op-cat-title', text: cat.title }), grid));
  }
}
function toggleOp(name, open) {
  const card = opCards[name];
  if (!card) return;
  const want = open === undefined ? !card.classList.contains('expanded') : open;
  card.classList.toggle('expanded', want);
  card.setAttribute('aria-expanded', want);
  if (want) { card._ta.value = fnSource(OPS[name].fn); fitRows(card._ta); card._ta.classList.remove('modified'); card._ta.focus(); card.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
  else card.focus();
}
ui.nowCode.addEventListener('click', openCurrentOp);
ui.nowCode.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); openCurrentOp(); } });
function openCurrentOp() {
  const ins = program[cpu.pc];
  if (!ins || cpu.halted) return;
  buildCpuOps();
  toggleOp(canonical(ins.tokens[0]), true);
}

/* manual */
const refCards = {};
function buildReference() {
  const frag = h('div', { class: 'ref-grid' });
  let count = 0;
  const addOp = (name, syntax, note, key) => {
    const card = h('div', { class: 'ref-op', 'data-search': `${name} ${syntax} ${note}`.toLowerCase() },
      h('div', { class: 'ref-head' }, h('span', { class: 'ref-name', text: name }), h('span', { class: 'ref-syntax', text: syntax })),
      h('div', { class: 'ref-note', text: note }));
    if (key) refCards[key] = card;
    frag.append(card);
  };
  for (const cat of CATEGORIES) {
    frag.append(h('div', { class: 'ref-title', text: cat.title }));
    for (const name of cat.ops) {
      const d = OPS[name];
      addOp(name, d.syntax, d.note, name);
      count++;
      if (name === 'JEQ') { addOp('JZ', 'label', 'Alias for JEQ.'); }
      if (name === 'JNE') { addOp('JNZ', 'label', 'Alias for JNE.'); }
    }
  }
  frag.append(h('div', { class: 'ref-title', text: 'Syntax' }));
  addOp(';', 'comment', 'A comment, to the end of the line.');
  addOp('label:', '', 'Names the next instruction. Jumps, CALL and MOV accept labels.');
  addOp('[x]', 'indirect', 'Dereference memory. Works as a source or a destination.');
  addOp('0x…, 0b…', 'literal', 'Hex and binary literals, e.g. 0xFF or 0b1010. Negatives allowed.');
  frag.append(h('div', { class: 'ref-empty', text: 'No instruction matches that search.', hidden: true }));
  ui.refScroll.replaceChildren(frag);
  ui.opsCount.textContent = `${count} ops`;
}
function filterReference(q) {
  q = q.trim().toLowerCase();
  const ops = $$('.ref-op', ui.refScroll);
  let any = false;
  ops.forEach(el => { const m = !q || el.dataset.search.includes(q); el.classList.toggle('hidden', !m); any = any || m; });
  $$('.ref-title', ui.refScroll).forEach(t => {
    let el = t.nextElementSibling, vis = false;
    while (el && el.classList.contains('ref-op')) { if (!el.classList.contains('hidden')) vis = true; el = el.nextElementSibling; }
    t.classList.toggle('hidden', !vis);
  });
  $('.ref-empty', ui.refScroll).hidden = any;
}
byId('refSearch').addEventListener('input', e => filterReference(e.target.value));
byId('refSearch').addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  if (e.target.value) { e.target.value = ''; filterReference(''); } else e.target.blur();
});

/* ---------- §8 editors --------------------------------------------------- */
/* Syntax highlighting: one line of source in, one line of HTML out. */
const RE_REG = /^(?:R[1-4]|PC|SP)$/i;
const RE_NUM = /^-?(?:0x[0-9a-f]+|0b[01]+|\d+)$/i;
const escH = t => t.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
function hlArgs(t) {
  let out = '', last = 0;
  t.replace(/\[|\]|[^\s,[\]]+/g, (m, at) => {
    out += escH(t.slice(last, at));
    out += m === '[' || m === ']' ? '<span class="t-p">' + m + '</span>'
      : '<span class="' + (RE_REG.test(m) ? 't-r' : RE_NUM.test(m) ? 't-n' : 't-l') + '">' + escH(m) + '</span>';
    last = at + m.length;
    return m;
  });
  return out + escH(t.slice(last));
}
function highlight(mode, line, lintErr) {
  if (!line) return '';
  const ci = line.indexOf(';');
  const code = ci < 0 ? line : line.slice(0, ci);
  const com = ci < 0 ? '' : '<span class="t-c">' + escH(line.slice(ci)) + '</span>';
  const m = /^(\s*)(?:([^\s:;]+:)(\s*))?(\S*)(.*)$/.exec(code);
  let out = escH(m[1]);
  if (m[2]) out += '<span class="t-l">' + escH(m[2]) + '</span>' + escH(m[3]);
  const word = m[4], rest = m[5];
  if (!word) return out + escH(rest) + com;
  const up = word.toUpperCase();
  if (mode === 'host' || (mode === 'hybrid' && !m[2] && HOST[up] && !OPS[up])) {
    out += '<span class="' + (HOST[up] ? 't-h' : 't-e') + '">' + escH(word) + '</span>';
    return out + (up === 'PRINT' || up === 'TTY' || up === 'JS' ? '<span class="t-s">' + escH(rest) + '</span>' : hlArgs(rest)) + com;
  }
  return out + '<span class="' + (OPS[up] && !lintErr ? 't-o' : 't-e') + '">' + escH(word) + '</span>' + hlArgs(rest) + com;
}

function makeEditor({ textarea, gutter, activeLine, clickable, mode }) {
  /* The gutter is virtualised: only the line numbers in view exist (about 40
     recycled rows), so typing, scrolling and resizing cost the same for a
     2,000-line program as for a 10-line one. */
  const LH = 20, PAD = 10; /* must match the textarea's line-height and top padding */
  const inner = h('div', { class: 'gutter-inner' });
  gutter.append(inner);
  if (clickable) gutter.classList.add('clickable');
  const rows = [];
  let lineCount = 1, scrollY = 0, scrollX = 0, viewH = 0, lines = [''];
  /* highlight layer: the textarea keeps the caret and selection, its text is
     transparent, and the coloured copy of the visible lines sits underneath */
  const hl = h('div', { class: 'hl', 'aria-hidden': 'true' });
  const hlInner = h('div', { class: 'hl-inner' });
  hl.append(hlInner);
  textarea.before(hl);
  textarea.classList.add('hl-on');
  const hlRows = [];
  let hFirst = -1, hN = -1, hLv = null, hShown = null;
  let bps = null, errs = null, bpV = 0, lintV = 0, active = -1;
  let pFirst = -1, pN = -1, pCount = -1, pBv = null, pLv = null, shownInner = null, shownY = null;
  const readLines = () => { lines = textarea.value.split('\n'); lineCount = lines.length; };
  function paintHL(force) {
    const first = Math.max(0, Math.floor((scrollY - PAD) / LH));
    const n = Math.ceil(viewH / LH) + 2;
    if (force || first !== hFirst || n !== hN || lintV !== hLv) {
      while (hlRows.length < n) { const el = document.createElement('div'); el.className = 'hl-line'; hlInner.append(el); hlRows.push({ el, src: '', err: false }); }
      for (let i = 0; i < hlRows.length; i++) {
        const line = first + i, r = hlRows[i];
        const src = i < n && line < lineCount ? lines[line] : '';
        const err = !!(src && errs && errs.has(line));
        if (src !== r.src || err !== r.err) { r.el.innerHTML = highlight(mode, src, err); r.src = src; r.err = err; }
      }
      hFirst = first; hN = n; hLv = lintV;
    }
    const key = scrollX + ',' + (PAD + first * LH - scrollY);
    if (key !== hShown) { hlInner.style.transform = `translate(${-scrollX}px, ${PAD + first * LH - scrollY}px)`; hShown = key; }
  }
  function rowClass(line) {
    let cls = 'ln';
    if (bps && bps.has(line)) cls += ' bp';
    if (errs && errs.has(line)) cls += ' err';
    if (line === active) cls += ' active';
    return cls;
  }
  function applyRow(r, line) {
    if (line < 0) {
      if (r.line !== -1) { r.el.textContent = ''; r.el.className = 'ln blank'; r.el.removeAttribute('data-line'); r.el.removeAttribute('data-tip'); r.line = -1; r.cls = 'ln blank'; r.tip = null; }
      return;
    }
    if (r.line !== line) { r.el.textContent = String(line + 1); r.el.setAttribute('data-line', line); r.line = line; }
    const cls = rowClass(line);
    if (cls !== r.cls) { r.el.className = cls; r.cls = cls; }
    const tip = (errs && errs.get(line)) || null;
    if (tip !== r.tip) { if (tip) r.el.setAttribute('data-tip', tip); else r.el.removeAttribute('data-tip'); r.tip = tip; }
  }
  function paint(force) {
    const first = Math.max(0, Math.floor((scrollY - PAD) / LH));
    const n = Math.ceil(viewH / LH) + 2;
    if (force || first !== pFirst || n !== pN || lineCount !== pCount || bpV !== pBv || lintV !== pLv) {
      while (rows.length < n) { const el = document.createElement('div'); el.className = 'ln blank'; inner.append(el); rows.push({ el, line: -1, cls: 'ln blank', tip: null }); }
      for (let i = 0; i < rows.length; i++) { const line = first + i; applyRow(rows[i], i < n && line < lineCount ? line : -1); }
      pFirst = first; pN = n; pCount = lineCount; pBv = bpV; pLv = lintV;
    }
    const y = PAD + first * LH - scrollY;
    if (y !== shownInner) { inner.style.transform = `translateY(${y}px)`; shownInner = y; }
  }
  function refreshLine(line) {
    const i = line - pFirst;
    if (line < 0 || i < 0 || i >= rows.length || rows[i].line !== line) return;
    applyRow(rows[i], line);
  }
  function positionActive() {
    if (active < 0) { if (!activeLine.hidden) activeLine.hidden = true; return; }
    if (activeLine.hidden) activeLine.hidden = false;
    const y = PAD + active * LH - scrollY;
    if (y !== shownY) { activeLine.style.transform = `translateY(${y}px)`; shownY = y; }
  }
  function render({ bps: b, bpVersion: bv, errs: e, lintVersion: lv, active: a }) {
    bps = b || null; errs = e || null;
    if (bv !== undefined) bpV = bv;
    if (lv !== undefined) lintV = lv;
    const prev = active;
    active = a;
    paint(false);
    paintHL(false);
    if (prev !== active) { refreshLine(prev); refreshLine(active); }
    positionActive();
  }
  function measure() { viewH = gutter.clientHeight; paint(false); paintHL(false); }
  new ResizeObserver(entries => { const hgt = entries[0].contentRect.height; if (hgt !== viewH) { viewH = hgt; paint(false); paintHL(false); } }).observe(gutter);
  /* scroll offsets are cached here, so rendering never has to read them (a forced layout) */
  textarea.addEventListener('scroll', () => { scrollY = textarea.scrollTop; scrollX = textarea.scrollLeft; paint(false); paintHL(false); positionActive(); }, { passive: true });
  textarea.addEventListener('input', () => { readLines(); paintHL(true); });
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!document.execCommand || !document.execCommand('insertText', false, '  ')) {
        const s = textarea.selectionStart;
        textarea.setRangeText('  ', s, textarea.selectionEnd, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  function setValue(v) { textarea.value = v; readLines(); textarea.scrollTop = 0; textarea.scrollLeft = 0; scrollY = 0; scrollX = 0; paint(false); paintHL(true); positionActive(); }
  function focusLine(idx) {
    const lines = textarea.value.split('\n');
    let pos = 0;
    for (let i = 0; i < idx; i++) pos += lines[i].length + 1;
    textarea.focus();
    textarea.setSelectionRange(pos, pos + (lines[idx] || '').length);
    textarea.scrollTop = Math.max(0, idx * LH - textarea.clientHeight / 2);
  }
  readLines();
  return { el: textarea, gutter: inner, render, setValue, focusLine, measure, get lines() { return lines; }, setActive(i) { render({ active: i }); }, get lineCount() { return lineCount; } };
}
const editors = {
  asm: makeEditor({ textarea: byId('asmEditor'), gutter: byId('asmGutter'), activeLine: byId('asmActiveLine'), clickable: true, mode: 'asm' }),
  host: makeEditor({ textarea: byId('hostEditor'), gutter: byId('hostGutter'), activeLine: byId('hostActiveLine'), mode: 'host' }),
  hybrid: makeEditor({ textarea: byId('hybridEditor'), gutter: byId('hybridGutter'), activeLine: byId('hybridActiveLine'), mode: 'hybrid' }),
};

/* breakpoints */
editors.asm.gutter.addEventListener('click', e => {
  const row = e.target.closest('.ln');
  if (!row || !row.hasAttribute('data-line')) return;
  const idx = +row.getAttribute('data-line');
  if (breakpoints.has(idx)) breakpoints.delete(idx); else breakpoints.add(idx);
  bpVersion++;
  if (program.length && !run.stale) snapBreakpoints();
  renderGutter();
});
function clearBreakpoints() { if (!breakpoints.size) return; breakpoints.clear(); bpVersion++; renderGutter(); }
let prevLines = [];
function remapBreakpoints(next) {
  if (!breakpoints.size || prevLines.length === next.length) return;
  const oldLen = prevLines.length, newLen = next.length, min = Math.min(oldLen, newLen);
  let p = 0; while (p < min && prevLines[p] === next[p]) p++;
  let s = 0; while (s < min - p && prevLines[oldLen - 1 - s] === next[newLen - 1 - s]) s++;
  const delta = newLen - oldLen, oldSuffix = oldLen - s;
  const out = new Set();
  for (const bp of breakpoints) {
    if (bp < p) out.add(bp);
    else if (bp >= oldSuffix) out.add(bp + delta);
    else if (bp < newLen - s) out.add(bp);
  }
  breakpoints = out; bpVersion++;
}

/* lint */
function applyLint(errs) {
  let same = errs.size === lintErrors.size;
  if (same) for (const [k, v] of errs) if (lintErrors.get(k) !== v) { same = false; break; }
  lintErrors = errs;
  if (same) return;
  lintVersion++;
  renderGutter();
  const bar = byId('lintBar');
  bar.hidden = errs.size === 0;
  if (errs.size) {
    const [line, msg] = [...errs.entries()].sort((a, b) => a[0] - b[0])[0];
    byId('lintBarText').innerHTML = `${errs.size} syntax error${errs.size === 1 ? '' : 's'} — line <b>${line + 1}</b>: ${esc(msg)}`;
  }
}
function lintNow() { applyLint(S.lint ? lintText(editors.asm.el.value) : new Map()); }
const lintSoon = debounce(lintNow, 220);
byId('lintBar').addEventListener('click', () => {
  if (!lintErrors.size) return;
  editors.asm.focusLine(Math.min(...lintErrors.keys()));
});

/* editor input: stale program, breakpoint remap, live parse, autosave, scans */
const saveAsm = debounce(() => store.set('program', editors.asm.el.value), 400);
const saveHost = debounce(() => store.set('host', editors.host.el.value), 400);
const saveHybrid = debounce(() => store.set('hybrid', editors.hybrid.el.value), 400);
editors.asm.el.addEventListener('input', () => {
  const next = editors.asm.lines;
  remapBreakpoints(next);
  prevLines = next;
  run.stale = true;
  if (S.live && (cpu.halted || cycles === 0)) { parseProgram(); }
  renderGutter();
  renderNow();
  lintSoon();
  scanSoon();
  saveAsm();
});
editors.host.el.addEventListener('input', () => { scanSoon(); saveHost(); });
editors.hybrid.el.addEventListener('input', saveHybrid);
function flushSaves() { saveAsm.flush(); saveHost.flush(); saveHybrid.flush(); saveSettings.flush(); }
addEventListener('pagehide', flushSaves);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSaves(); });

/* Large examples ship deflated (the kernel: 26 KB of text, 10 KB packed) and are
   unpacked by the browser the first time they are opened. */
const textHash = t => { let x = 0x811c9dc5; for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36) + ':' + t.length; };
const PACKED = typeof PACKED_EXAMPLES === 'undefined' ? {} : PACKED_EXAMPLES;
async function exampleText(name) {
  if (typeof EXAMPLES[name] === 'string') return EXAMPLES[name];
  if (!PACKED[name]) return null;
  const bytes = Uint8Array.from(atob(PACKED[name][0]), c => c.charCodeAt(0));
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  EXAMPLES[name] = text;
  return text;
}
function exampleFor(text) {
  for (const k in EXAMPLES) if (EXAMPLES[k] === text) return k;
  const key = textHash(text);
  for (const k in PACKED) if (PACKED[k][1] === key) return k;
  return null;
}
async function loadExample(name) {
  let text;
  try { text = await exampleText(name); } catch (e) { text = null; }
  if (text == null) { toast('This example could not be opened in this browser', 'err'); return; }
  editors.asm.setValue(text);
  prevLines = editors.asm.lines;
  breakpoints.clear(); bpVersion++;
  store.set('program', editors.asm.el.value);
  resetCPU();
  lintNow();
  scanForeign();
}
byId('exampleSelect').addEventListener('change', e => loadExample(e.target.value));
byId('btnClearBreaks').addEventListener('click', clearBreakpoints);

/* foreign-language detection (host commands in assembly and vice versa) */
function foreignTokens(text, mode) {
  const hits = [], seen = new Set();
  for (const raw of text.split('\n')) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const { label, rest } = splitLabel(line);
    if (mode === 'host' && label) { hits.push('labels'); break; }
    if (!rest) continue;
    const tok = rest.split(/\s+/)[0].toUpperCase().replace(/,+$/, '');
    const foreign = mode === 'asm' ? (HOST[tok] && !OPS[tok]) : (OPS[tok] && !HOST[tok]);
    if (foreign && !seen.has(tok)) { seen.add(tok); hits.push(tok); }
  }
  return hits;
}
function scanForeign() {
  const a = foreignTokens(editors.asm.el.value, 'asm');
  byId('asmForeign').hidden = a.length === 0;
  byId('asmForeignTokens').textContent = a.slice(0, 4).join(', ');
  const b = foreignTokens(editors.host.el.value, 'host');
  byId('hostForeign').hidden = b.length === 0;
  byId('hostForeignTokens').textContent = b.slice(0, 4).join(', ');
}
const scanSoon = debounce(() => { scanForeign(); syncExampleMenu(); }, 300);
/* The Example menu names the program only while it is unedited, so picking the
   same example again always reloads it. */
function syncExampleMenu() {
  const sel = byId('exampleSelect'), k = exampleFor(editors.asm.el.value) || '';
  if (sel.value !== k) sel.value = k;
}

/* tabs */
function makeTabs(container, onChange) {
  const tabs = $$('.tab', container);
  const api = { current: (tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0]).dataset.tab };
  function place(anim) {
    const t = tabs.find(x => x.dataset.tab === api.current);
    if (!t) return;
    container.classList.toggle('no-anim', !anim);
    container.style.setProperty('--ink-x', t.offsetLeft + 'px');
    container.style.setProperty('--ink-w', t.offsetWidth + 'px');
    if (!anim) requestAnimationFrame(() => container.classList.remove('no-anim'));
  }
  api.select = (key, opts = {}) => {
    const t = tabs.find(x => x.dataset.tab === key);
    if (!t) return;
    const prev = api.current;
    api.current = key;
    tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
    place(!opts.instant);
    if (opts.focus) t.focus();
    if (prev !== key || opts.force) onChange(key, prev);
  };
  api.place = place;
  tabs.forEach(t => t.addEventListener('click', () => api.select(t.dataset.tab)));
  container.addEventListener('keydown', e => {
    const i = tabs.findIndex(x => x.dataset.tab === api.current);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    api.select(tabs[n].dataset.tab, { focus: true });
  });
  new ResizeObserver(() => place(false)).observe(container);
  place(false);
  return api;
}
const PANES = {};
$$('.tab-pane').forEach(p => { PANES[p.dataset.pane] = p; });
const editorTabs = makeTabs($('[data-tabs="editor"]'), key => {
  for (const k of ['asm', 'host', 'hybrid']) PANES[k].hidden = k !== key;
  editors[key].measure();
  if (S.clockSep && S.clockAuto) applySpeed(S.tabClocks[key]);
  syncClockUI();
  if (key === 'asm') renderGutter();
});
const machineTabs = makeTabs($('[data-tabs="machine"]'), key => {
  PANES.memory.hidden = key !== 'memory';
  PANES.cpu.hidden = key !== 'cpu';
  if (key === 'cpu') { buildCpuOps(); nowShown.name = nowShown.summary = nowShown.args = nowShown.code = null; renderNow(); }
  if (key === 'memory') fitMemory();
});

/* ---------- §9 host commands + hybrid ----------------------------------- */
let logTarget = byId('hostOutput');
function hostPrint(markup, cls) {
  const line = h('div', { class: cls || null, html: markup });
  logTarget.append(line);
  while (logTarget.childNodes.length > 2000) logTarget.removeChild(logTarget.firstChild);
  logTarget.scrollTop = logTarget.scrollHeight;
}
const val = v => `<span class="val">${esc(v)}</span>`;
const hostNum = t => read(String(t).toUpperCase());
const onOff = (a, cur, name) => {
  const w = (a || 'TOGGLE').toLowerCase();
  if (w !== 'on' && w !== 'off' && w !== 'toggle') throw new Error(name + ' wants on, off or toggle');
  return w === 'toggle' ? !cur : w === 'on';
};
const HOST = {
  PRINT: { args: 'text…', summary: 'write to this log', run: (a, raw) => hostPrint(esc(raw), 'echo') },
  TTY: { args: 'text…', summary: "write into the machine's TTY", run: (a, raw) => { tty.line('<span class="host">host›</span> ' + esc(raw)); tty.flush(); hostPrint('sent to TTY', 'ok'); } },
  SET: { args: 'reg value', summary: 'set a register (R1–R4, PC, SP)', run: a => { if (a.length < 2) throw new Error('SET needs: reg value'); const v = hostNum(a[1]); writeReg(a[0], v); hostPrint(`${a[0]} = ${val(v)}`); } },
  FLAG: { args: 'ZF|SF 0|1', summary: 'set a flag', run: a => { if (a.length < 2) throw new Error('FLAG needs: name 0|1'); if (!(a[0] in cpu.flags)) throw new Error(`No flag "${a[0]}"`); cpu.flags[a[0]] = hostNum(a[1]) ? 1 : 0; hostPrint(`${a[0]} = ${val(cpu.flags[a[0]])}`); } },
  MEM: { args: 'addr value', summary: 'write one RAM cell', run: a => { if (a.length < 2) throw new Error('MEM needs: addr value'); const addr = hostNum(a[0]), v = hostNum(a[1]); writeMem(addr, v); hostPrint(`[${addr}] = ${val(v | 0)}`); } },
  PEEK: { args: 'addr', summary: 'read one RAM cell', run: a => { const addr = hostNum(a[0]); if (addr < 0 || addr >= MEM_SIZE) throw new Error('Out of range: ' + addr); hostPrint(`[${addr}] → ${val(cpu.memory[addr])}`); } },
  FILL: { args: 'start end value', summary: 'fill a RAM range', run: a => {
    if (a.length < 3) throw new Error('FILL needs: start end value');
    let st = hostNum(a[0]), en = hostNum(a[1]); const v = hostNum(a[2]);
    if (st > en) [st, en] = [en, st];
    if (st < 0 || en >= MEM_SIZE) throw new Error(`Range outside RAM (0–${MEM_SIZE - 1})`);
    for (let i = st; i <= en; i++) cpu.memory[i] = v | 0;
    recentWrite = en;
    hostPrint(`[${st}…${en}] = ${val(v | 0)} · ${en - st + 1} cells`);
  } },
  DUMP: { args: 'addr [count]', summary: 'hex view of a RAM range', run: a => {
    const st = hostNum(a[0]); const n = clamp(a[1] ? hostNum(a[1]) : 16, 1, 256);
    if (st < 0 || st >= MEM_SIZE) throw new Error('Out of range: ' + st);
    const en = Math.min(st + n, MEM_SIZE);
    let row = [];
    for (let i = st; i < en; i++) {
      row.push(fmtHex2(cpu.memory[i]));
      if (row.length === 16 || i === en - 1) { hostPrint(`${val(fmtAddr(i - row.length + 1))}  ${row.join(' ')}`); row = []; }
    }
  } },
  RUN: { args: '', summary: 'start or resume the CPU', run: () => { runButton(); hostPrint('▶ machine running', 'ok'); } },
  PAUSE: { args: '', summary: 'pause the CPU', run: () => { pause(); hostPrint('‖ machine paused', 'ok'); } },
  STEP: { args: '[n]', summary: 'execute n instructions (default 1)', run: a => { const n = clamp(a[0] ? hostNum(a[0]) : 1, 1, 1000); for (let i = 0; i < n; i++) stepExecution(); hostPrint(`stepped ${val(n)}`); } },
  RESET: { args: '', summary: 'reset CPU, RAM and TTY', run: () => { resetCPU(); hostPrint('machine reset', 'ok'); } },
  CLOCK: { args: '[asm|host|hybrid] ms', summary: 'set the clock period, optionally for one tab', run: a => {
    let tab = editorTabs.current, raw = a[0];
    const first = (a[0] || '').toLowerCase();
    if (CLOCK_FIELDS[first]) { tab = first; raw = a[1]; }
    const ms = hostNum(raw);
    if (Number.isNaN(ms) || ms < 0) throw new Error('Clock must be a number ≥ 0');
    setTabClock(tab, ms);
    hostPrint(`clock ${tab} = ${val(ms + 'ms')}`);
  } },
  CLOCKSEP: { args: 'on|off', summary: 'per-tab clocks (on) or one shared clock (off)', run: a => { setSetting('clockSep', onOff(a[0], S.clockSep, 'CLOCKSEP')); hostPrint(`per-tab clock → ${val(S.clockSep ? 'separate' : 'linked')}`); } },
  CLOCKAUTO: { args: 'on|off', summary: 'adopt a tab’s clock when switching tabs', run: a => { setSetting('clockAuto', onOff(a[0], S.clockAuto, 'CLOCKAUTO')); hostPrint(`clock auto-switch → ${val(S.clockAuto ? 'auto' : 'manual')}`); } },
  DEFCLOCK: { args: 'ms', summary: 'default clock, applied now and at every start', run: a => { const ms = hostNum(a[0]); if (ms < 0) throw new Error('Clock must be ≥ 0'); setSetting('defaultClock', ms); hostPrint(`default clock → ${val(ms + 'ms')}`); } },
  PACE: { args: 'host|hybrid ms', summary: 'delay between script lines, independent of the CPU', run: a => {
    const t = (a[0] || '').toLowerCase();
    if (t !== 'host' && t !== 'hybrid') throw new Error('PACE wants: host|hybrid ms');
    const ms = hostNum(a[1]); if (ms < 0) throw new Error('Pace must be ≥ 0');
    setSetting(t === 'host' ? 'hostPace' : 'hybridPace', ms);
    hostPrint(`pace ${t} → ${val(ms + 'ms')}`);
  } },
  THEME: { args: 'light|dark|toggle', summary: 'switch the theme', run: a => {
    const w = (a[0] || 'TOGGLE').toLowerCase();
    if (!['light', 'dark', 'toggle'].includes(w)) throw new Error('THEME wants light, dark or toggle');
    setTheme(w === 'toggle' ? (html.dataset.theme === 'dark' ? 'light' : 'dark') : w);
    hostPrint(`theme → ${val(html.dataset.theme)}`);
  } },
  MOTION: { args: 'auto|reduce|full', summary: 'animation preference', run: a => { const w = (a[0] || '').toLowerCase(); if (!['auto', 'reduce', 'full'].includes(w)) throw new Error('MOTION wants auto, reduce or full'); setSetting('motion', w); hostPrint(`motion → ${val(w)}`); } },
  TIPS: { args: 'on|off', summary: 'hover-info popovers', run: a => { setSetting('tips', onOff(a[0], S.tips, 'TIPS')); hostPrint(`hover info → ${val(S.tips ? 'on' : 'off')}`); } },
  SOUND: { args: 'off|sine|square|triangle|sawtooth|custom', summary: 'RAM beep waveform', run: a => {
    const w = (a[0] || '').toLowerCase();
    if (!audio.modes().includes(w)) throw new Error('SOUND wants one of: ' + audio.modes().join(', '));
    if (w !== 'off' && !audio.ensure()) throw new Error('audio is unavailable in this browser');
    setSetting('sound', w);
    if (w !== 'off') { audio.last = 0; audio.beep(64); }
    hostPrint(`beep waveform → ${val(w)}`);
  } },
  VOLUME: { args: '0–100', summary: 'RAM beep volume', run: a => { setSetting('volume', clamp(hostNum(a[0]), 0, 100)); hostPrint(`volume → ${val(S.volume)}${S.muted ? ' (muted)' : ''}`); } },
  MUTE: { args: '[on|off|toggle]', summary: 'mute the RAM beep', run: a => { setSetting('muted', onOff(a[0], S.muted, 'MUTE')); hostPrint(`mute → ${val(S.muted ? 'on' : 'off')}`); } },
  PITCH: { args: '50–2000', summary: 'RAM beep base frequency in Hz', run: a => { setSetting('pitch', Math.round(clamp(hostNum(a[0]), 50, 2000))); hostPrint(`pitch → ${val(S.pitch + ' Hz')}`); } },
  BEEP: { args: 'byte', summary: 'play the RAM beep (needs sound on)', run: a => { const b = hostNum(a[0]) & 0xff; if (S.sound === 'off') { hostPrint('sound is off — pick a waveform in Settings or with SOUND', 'err'); return; } audio.ensure(); audio.last = 0; audio.beep(b); hostPrint(`♪ beep ${val(b)}`); } },
  SOUNDFILE: { args: 'pick|clear', summary: 'custom RAM-beep sample', run: a => { const w = (a[0] || '').toLowerCase(); if (w === 'pick') { pickBeepFile(); hostPrint('choose a sound…'); return; } if (w === 'clear') { setBeepFile(null); hostPrint(`custom beep → ${val('none')}`); return; } throw new Error('SOUNDFILE wants pick or clear'); } },
  GUARD: { args: '[on|off|toggle]', summary: 'divide-by-zero guard', run: a => { setSetting('divZero', onOff(a[0], S.divZero, 'GUARD')); hostPrint(`÷0 guard → ${val(S.divZero ? 'on · halt' : 'off · yield 0')}`); } },
  BASE: { args: 'dec|hex|toggle', summary: 'display base for registers and memory', run: a => { const w = (a[0] || 'TOGGLE').toLowerCase(); if (!['dec', 'hex', 'toggle'].includes(w)) throw new Error('BASE wants dec, hex or toggle'); setSetting('base', w === 'toggle' ? (S.base === 'dec' ? 'hex' : 'dec') : w); hostPrint(`display base → ${val(S.base.toUpperCase())}`); } },
  LINT: { args: '[on|off|toggle]', summary: 'live syntax checking', run: a => { setSetting('lint', onOff(a[0], S.lint, 'LINT')); hostPrint(`syntax check → ${val(S.lint ? 'on' : 'off')}`); } },
  STRICT: { args: '[on|off|toggle]', summary: 'block Run while syntax errors remain', run: a => { setSetting('strict', onOff(a[0], S.strict, 'STRICT')); hostPrint(`strict run → ${val(S.strict ? 'on' : 'off')}`); } },
  LIVE: { args: '[on|off|toggle]', summary: 're-parse the editor as you type', run: a => { setSetting('live', onOff(a[0], S.live, 'LIVE')); hostPrint(`live program → ${val(S.live ? 'on' : 'off')}`); } },
  BACKDROP: { args: 'pick|clear|url <link>', summary: 'page backdrop image', run: (a, raw) => {
    const w = (a[0] || '').toLowerCase();
    if (w === 'pick') { pickBackdrop(); hostPrint('choose an image…'); return; }
    if (w === 'clear') { setBackdrop(null); hostPrint(`backdrop → ${val('default')}`); return; }
    if (w === 'url') { const url = raw.slice(raw.toLowerCase().indexOf('url') + 3).trim(); if (!url) throw new Error('BACKDROP url needs a link'); if (!setBackdrop(url)) throw new Error('could not store the backdrop'); hostPrint(`backdrop → ${val(url.slice(0, 48))}`); return; }
    throw new Error('BACKDROP wants pick, clear or url <link>');
  } },
  PIN: { args: PIN_ORDER.join('|') + ' [on|off|toggle]', summary: 'mirror a setting into the footer bar', run: a => {
    const key = PIN_ORDER.find(k => k.toLowerCase() === (a[0] || '').toLowerCase());
    if (!key) throw new Error('PIN wants one of: ' + PIN_ORDER.join(', '));
    setPin(key, onOff(a[1], !!S.pins[key], 'PIN'));
    hostPrint(`footer pin ${key} → ${val(S.pins[key] ? 'on' : 'off')}`);
  } },
  FLOAT: { args: 'editor|machine|manual', summary: 'unsnap a window so it can be dragged anywhere', run: a => { const k = (a[0] || '').toLowerCase(); if (!panels[k]) throw new Error('FLOAT wants editor, machine or manual'); floatPanel(panels[k], true); hostPrint(`window ${k} → ${val('floating')} · drag its title, double-click to snap`); } },
  SNAP: { args: 'editor|machine|manual|all', summary: 'snap a window back into the grid', run: a => { const k = (a[0] || '').toLowerCase(); if (k === 'all') { for (const p in panels) snapHome(panels[p]); hostPrint(`all windows → ${val('snapped')}`); return; } if (!panels[k]) throw new Error('SNAP wants editor, machine, manual or all'); snapHome(panels[k]); hostPrint(`window ${k} → ${val('snapped')}`); } },
  WAIT: { args: 'ms', summary: 'pause the script (max 10 s)', run: async a => { const ms = clamp(hostNum(a[0]), 0, 10000); renderAll(); await new Promise(r => setTimeout(r, ms)); hostPrint(`waited ${val(ms + 'ms')}`); } },
  JS: { args: 'expression…', summary: 'evaluate JavaScript on the host (cpu is in scope)', run: (a, raw) => {
    if (!raw) throw new Error('JS needs an expression');
    const v = new Function('cpu', 'return (' + raw + ');')(cpu);
    let shown; try { shown = v === undefined ? 'undefined' : JSON.stringify(v); } catch (e) { shown = String(v); }
    hostPrint(`js → ${val(shown)}`);
  } },
  HELP: { args: '', summary: 'list every command', run: () => { for (const k in HOST) hostPrint(`${val(k)} ${esc(HOST[k].args)} — ${esc(HOST[k].summary)}`); } },
};
async function runHostLine(line, lineNo) {
  const sp = line.indexOf(' ');
  const word = (sp === -1 ? line : line.slice(0, sp)).toUpperCase();
  const raw = sp === -1 ? '' : line.slice(sp + 1).trim();
  const cmd = HOST[word];
  if (!cmd) { hostPrint(`line ${lineNo}: unknown command "${esc(word)}" — try HELP`, 'err'); return; }
  try { await cmd.run(raw ? raw.split(/\s+/).map(t => t.toUpperCase()) : [], raw); }
  catch (err) { hostPrint(`line ${lineNo}: ${esc(err.message)}`, 'err'); }
  renderAll();
}
let hostRunning = false;
async function runHostScript() {
  if (hostRunning) return;
  hostRunning = true;
  const btn = byId('btnHostRun');
  btn.disabled = true;
  logTarget = byId('hostOutput');
  hostPrint('── system script ──', 'ok');
  try {
    const lines = editors.host.el.value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = stripComment(lines[i]).trim();
      if (!line) continue;
      editors.host.setActive(i);
      await runHostLine(line, i + 1);
      if (S.hostPace > 0) await new Promise(r => setTimeout(r, S.hostPace));
    }
  } finally {
    hostRunning = false;
    btn.disabled = false;
    editors.host.setActive(-1);
  }
}
byId('btnHostRun').addEventListener('click', runHostScript);
byId('btnHostClear').addEventListener('click', () => { byId('hostOutput').textContent = ''; });

/* hybrid: contiguous assembly lines run on the CPU, host lines in between */
let hybridRunning = false, hybridStop = false;
function classifyHybrid(raw) {
  const line = stripComment(raw).trim();
  if (!line) return 'blank';
  const { label, rest } = splitLabel(line);
  const tok = rest ? rest.split(/\s+/)[0].toUpperCase().replace(/,+$/, '') : '';
  if (label || (tok && OPS[tok] && !HOST[tok])) return 'asm';
  if (tok && HOST[tok]) return 'host';
  return 'unknown';
}
function runHybridBlock(lines) {
  const r = assemble(lines.map(x => x.text).join('\n'));
  /* keep source line numbers of the whole script for the gutter */
  r.program.forEach(p => { p.line = lines[p.line].idx; });
  program = r.program; labels = r.labels; run.stale = true;
  if (!program.length) return Promise.resolve();
  hostPrint(`▶ cpu block · ${program.length} instruction${program.length === 1 ? '' : 's'}`, 'ok');
  setStatus('HYBRID · CPU', 'run');
  setLeds(true);
  return new Promise(resolve => {
    cpu.halted = false; cpu.pc = 0;
    const c0 = cycles;
    const chunk = run.speed === 0 ? 5000 : 1;
    const done = () => { clearInterval(iv); editors.hybrid.setActive(-1); setLeds(false); hostPrint(`■ cpu block done · ${cycles - c0} cycles`, 'ok'); resolve(); };
    const iv = setInterval(() => {
      if (hybridStop || cpu.halted) { done(); return; }
      for (let i = 0; i < chunk; i++) { if (cpu.halted || cpu.waitingFor || hybridStop) break; execute(chunk > 1); }
      const cur = program[cpu.pc];
      editors.hybrid.setActive(!cpu.halted && cur ? cur.line : -1);
      if (chunk > 1) renderAll();
      if (cpu.halted || hybridStop) done();
    }, run.speed === 0 ? 0 : run.speed);
  });
}
async function runHybridScript() {
  if (hybridRunning) return;
  hybridRunning = true; hybridStop = false;
  const runBtn = byId('btnHybridRun'), stopBtn = byId('btnHybridStop');
  runBtn.disabled = true; stopBtn.disabled = false;
  ui.btnRun.disabled = true; ui.btnStep.disabled = true;
  logTarget = byId('hybridOutput');
  hostPrint('── hybrid script ──', 'ok');
  try {
    const lines = editors.hybrid.el.value.split('\n');
    let block = [];
    for (let i = 0; i <= lines.length; i++) {
      if (hybridStop) break;
      const atEnd = i === lines.length;
      const kind = atEnd ? 'blank' : classifyHybrid(lines[i]);
      if (kind === 'asm') { block.push({ text: lines[i], idx: i }); continue; }
      if (block.length) { const b = block; block = []; await runHybridBlock(b); }
      if (atEnd) break;
      if (kind === 'blank' || hybridStop) continue;
      if (kind === 'unknown') { hostPrint(`line ${i + 1}: neither assembly nor a host command — skipped`, 'err'); continue; }
      editors.hybrid.setActive(i);
      await runHostLine(stripComment(lines[i]).trim(), i + 1);
      if (S.hybridPace > 0) await new Promise(r => setTimeout(r, S.hybridPace));
    }
    hostPrint(hybridStop ? '■ stopped' : '── done ──', hybridStop ? 'err' : 'ok');
  } finally {
    logTarget = byId('hostOutput');
    editors.hybrid.setActive(-1);
    hybridRunning = false; hybridStop = false;
    runBtn.disabled = false; stopBtn.disabled = true;
    ui.btnRun.disabled = false; ui.btnStep.disabled = false;
    setStatus('READY', 'ready');
    setLeds(false);
    renderAll();
  }
}
byId('btnHybridRun').addEventListener('click', runHybridScript);
byId('btnHybridStop').addEventListener('click', () => { hybridStop = true; });
byId('btnHybridClear').addEventListener('click', () => { byId('hybridOutput').textContent = ''; });

/* "make it hybrid" dialog */
let hybridSource = null;
byId('asmForeign').addEventListener('click', () => openHybridModal('asm'));
byId('hostForeign').addEventListener('click', () => openHybridModal('host'));
function openHybridModal(src) {
  hybridSource = src;
  const from = src === 'asm' ? editors.asm : editors.host;
  const toks = esc(foreignTokens(from.el.value, src).slice(0, 4).join(', '));
  byId('hybridModalBody').innerHTML = (src === 'asm'
    ? `Your assembly contains System commands (<b>${toks}</b>) that the CPU cannot execute.`
    : `Your System script contains assembly (<b>${toks}</b>) that the host shell cannot run.`)
    + '<br><br>The <b>Hybrid</b> tab runs both side by side without changing either: assembly blocks run on the CPU exactly as normal, host lines run in plain JavaScript between them, and both share one machine — registers and RAM carry across the whole script.<br><br>Append this code to the Hybrid tab?';
  openModal(byId('hybridModal'));
}
byId('hybridModalCancel').addEventListener('click', () => closeModal(byId('hybridModal')));
byId('hybridModalOk').addEventListener('click', () => {
  const from = hybridSource === 'asm' ? editors.asm : editors.host;
  const moved = from.el.value.replace(/\s+$/, '');
  const base = editors.hybrid.el.value.replace(/\s+$/, '');
  editors.hybrid.setValue(base ? base + '\n\n' + moved + '\n' : moved + '\n');
  editors.hybrid.el.dispatchEvent(new Event('input', { bubbles: true }));
  closeModal(byId('hybridModal'));
  editorTabs.select('hybrid');
  editors.hybrid.el.focus();
});

/* ---------- §10 script library ------------------------------------------ */
const KINDS = { asm: { label: 'Assembly', select: 'savedSelAsm', editor: () => editors.asm }, host: { label: 'System', select: 'savedSelHost', editor: () => editors.host }, hybrid: { label: 'Hybrid', select: 'savedSelHybrid', editor: () => editors.hybrid } };
function loadLibrary() { try { const a = JSON.parse(store.get('scripts') || store.legacy('scripts') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function saveLibrary(arr) { store.set('scripts', JSON.stringify(arr)); refreshSavedSelects(); }
function refreshSavedSelects() {
  const lib = loadLibrary();
  for (const kind in KINDS) {
    const sel = byId(KINDS[kind].select);
    const cur = sel.value;
    sel.replaceChildren(h('option', { value: '', text: '— load —' }));
    lib.filter(x => x.kind === kind).sort((a, b) => a.name.localeCompare(b.name)).forEach(x => sel.append(h('option', { value: x.name, text: x.name })));
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  }
}
for (const kind in KINDS) {
  byId(KINDS[kind].select).addEventListener('change', e => {
    const name = e.target.value;
    if (!name) return;
    const hit = loadLibrary().find(x => x.kind === kind && x.name === name);
    if (!hit) return;
    const ed = KINDS[kind].editor();
    ed.setValue(hit.code);
    ed.el.dispatchEvent(new Event('input', { bubbles: true }));
    if (kind === 'asm') { prevLines = ed.el.value.split('\n'); breakpoints.clear(); bpVersion++; resetCPU(); }
    toast(`Loaded “${name}”`, 'ok', 2200);
  });
}
let libKind = 'asm';
function openLibrary(kind) {
  libKind = kind;
  byId('scriptModalKind').textContent = KINDS[kind].label;
  const inp = byId('scriptNameInput');
  inp.value = '';
  libNote('');
  renderLibraryList();
  openModal(byId('scriptModal'), inp);
}
function libNote(text, kind) { const n = byId('scriptModalNote'); n.textContent = text; n.className = 'modal-note' + (kind ? ' ' + kind : ''); }
function renderLibraryList() {
  const list = byId('scriptList');
  const items = loadLibrary().filter(x => x.kind === libKind).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  list.replaceChildren();
  if (!items.length) { list.append(h('div', { class: 'script-empty', text: `No saved ${KINDS[libKind].label} scripts yet.` })); return; }
  for (const x of items) {
    const row = h('div', { class: 'script-row' },
      h('span', { class: 'nm', text: x.name, title: x.name }),
      h('span', { class: 'dt', text: x.savedAt ? new Date(x.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '' }),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { byId(KINDS[libKind].select).value = x.name; byId(KINDS[libKind].select).dispatchEvent(new Event('change')); closeModal(byId('scriptModal')); } }, 'Load'),
      h('button', { class: 'btn sm ghost danger', type: 'button', 'aria-label': 'Delete ' + x.name, onclick: () => { saveLibrary(loadLibrary().filter(y => !(y.kind === libKind && y.name === x.name))); renderLibraryList(); libNote(`Deleted “${x.name}”`, 'ok'); } }, 'Delete'));
    list.append(row);
  }
}
byId('scriptNameInput').addEventListener('input', e => {
  const name = e.target.value.trim();
  const exists = name && loadLibrary().some(x => x.kind === libKind && x.name === name);
  libNote(exists ? `“${name}” exists — saving will overwrite it.` : '');
});
byId('scriptNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmSave(); } });
function confirmSave() {
  const name = byId('scriptNameInput').value.trim();
  if (!name) { libNote('Give the script a name first.', 'err'); return; }
  const code = KINDS[libKind].editor().el.value;
  const lib = loadLibrary().filter(x => !(x.kind === libKind && x.name === name));
  lib.push({ name, kind: libKind, code, savedAt: Date.now() });
  saveLibrary(lib);
  byId(KINDS[libKind].select).value = name;
  closeModal(byId('scriptModal'));
  toast(`Saved “${name}”`, 'ok', 2200);
}
byId('scriptModalOk').addEventListener('click', confirmSave);
byId('scriptModalCancel').addEventListener('click', () => closeModal(byId('scriptModal')));
byId('btnSaveAsm').addEventListener('click', () => openLibrary('asm'));
byId('btnSaveHost').addEventListener('click', () => openLibrary('host'));
byId('btnSaveHybrid').addEventListener('click', () => openLibrary('hybrid'));
byId('btnExportScripts').addEventListener('click', () => {
  const lib = loadLibrary();
  if (!lib.length) { libNote('Nothing to export yet.', 'err'); return; }
  const blob = new Blob([JSON.stringify({ app: 'mica', version: 1, exportedAt: new Date().toISOString(), scripts: lib }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'mica-scripts.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  libNote(`Exported ${lib.length} script${lib.length === 1 ? '' : 's'}.`, 'ok');
});
byId('btnImportScripts').addEventListener('click', () => {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    f.text().then(text => {
      let data; try { data = JSON.parse(text); } catch (e) { libNote('That file is not valid JSON.', 'err'); return; }
      const arr = Array.isArray(data) ? data : data && Array.isArray(data.scripts) ? data.scripts : null;
      if (!arr) { libNote('No scripts found in that file.', 'err'); return; }
      const lib = loadLibrary();
      let added = 0, updated = 0;
      for (const x of arr) {
        if (!x || typeof x.name !== 'string' || typeof x.code !== 'string' || !KINDS[x.kind]) continue;
        const clean = { name: x.name.slice(0, 40), kind: x.kind, code: x.code, savedAt: typeof x.savedAt === 'number' ? x.savedAt : Date.now() };
        const i = lib.findIndex(y => y.kind === clean.kind && y.name === clean.name);
        if (i === -1) { lib.push(clean); added++; } else { lib[i] = clean; updated++; }
      }
      saveLibrary(lib);
      renderLibraryList();
      libNote(`Imported: ${added} new, ${updated} updated.`, 'ok');
    });
  });
  input.click();
});

/* ---------- §11 modals, drawer, toast, tips ----------------------------- */
let modalOpener = null;
function openModal(el, focusEl) {
  const scrim = byId('modalScrim');
  modalOpener = document.activeElement;
  scrim.hidden = false; scrim.classList.remove('closing');
  el.hidden = false; el.classList.remove('closing');
  (focusEl || el.querySelector('input, button')).focus();
}
function closeModal(el) {
  if (el.hidden) return;
  const scrim = byId('modalScrim');
  const dur = reducedMotion() ? 0 : 140;
  el.classList.add('closing'); scrim.classList.add('closing');
  setTimeout(() => { el.hidden = true; scrim.hidden = true; el.classList.remove('closing'); scrim.classList.remove('closing'); }, dur);
  if (modalOpener && modalOpener.focus) modalOpener.focus();
  modalOpener = null;
}
byId('modalScrim').addEventListener('click', () => $$('.modal').forEach(m => closeModal(m)));
const openModalEl = () => $$('.modal').find(m => !m.hidden);

const drawer = byId('settingsDrawer'), drawerScrim = byId('drawerScrim');
let drawerOpener = null;
function openSettings(open) {
  const isOpen = !drawer.hidden && !drawer.classList.contains('closing');
  if (open === undefined) open = !isOpen;
  if (open === isOpen) return;
  byId('settingsToggle').setAttribute('aria-expanded', open);
  document.body.classList.toggle('settings-open', open);
  if (open) {
    drawerOpener = document.activeElement;
    drawerScrim.hidden = false; drawerScrim.classList.remove('closing');
    drawer.hidden = false; drawer.classList.remove('closing');
    const first = drawer.querySelector('.drawer-body button, .drawer-body input');
    if (first) first.focus({ preventScroll: true });
  } else {
    const dur = reducedMotion() ? 0 : 280;
    drawer.classList.add('closing'); drawerScrim.classList.add('closing');
    setTimeout(() => { if (drawer.classList.contains('closing')) { drawer.hidden = true; drawerScrim.hidden = true; drawer.classList.remove('closing'); drawerScrim.classList.remove('closing'); } }, dur);
    if (drawerOpener && drawerOpener.focus) drawerOpener.focus();
  }
}
byId('settingsToggle').addEventListener('click', () => openSettings());
byId('settingsClose').addEventListener('click', () => openSettings(false));
drawerScrim.addEventListener('click', () => openSettings(false));

let toastTimer = null;
function toast(msg, kind, ms) {
  clearTimeout(toastTimer);
  ui.toastText.textContent = msg;
  ui.toast.className = 'toast' + (kind ? ' ' + kind : '');
  ui.toast.hidden = false;
  toastTimer = setTimeout(hideToast, ms || 5000);
}
function hideToast() {
  clearTimeout(toastTimer);
  if (ui.toast.hidden) return;
  ui.toast.classList.add('closing');
  setTimeout(() => { ui.toast.hidden = true; ui.toast.classList.remove('closing'); }, reducedMotion() ? 0 : 130);
}
byId('toastClose').addEventListener('click', hideToast);

/* hover tips: data-tip text after a short delay; instant while one was just open */
const tip = { el: ui.tip, target: null, timer: null, lastHide: 0, x: 0, y: 0 };
function showTip(el) {
  const text = el.getAttribute('data-tip') || '';
  if (text) placeTip(text, el.getBoundingClientRect());
}
function placeTip(text, r) {
  if (tip.el.textContent !== text) tip.el.textContent = text;
  tip.el.classList.toggle('instant', !tip.el.hidden || performance.now() - tip.lastHide < 350);
  tip.el.hidden = false;
  const w = tip.el.offsetWidth, hgt = tip.el.offsetHeight;
  let left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8);
  let top = r.top - hgt - 8;
  let origin = '50% 100%';
  if (top < 8) { top = r.bottom + 8; origin = '50% 0%'; }
  tip.el.style.left = left + 'px';
  tip.el.style.top = top + 'px';
  tip.el.style.setProperty('--tip-origin', origin);
}
function hideTip() {
  clearTimeout(tip.timer); tip.timer = null;
  if (!tip.el.hidden) { tip.el.hidden = true; tip.lastHide = performance.now(); }
  tip.target = null;
}
document.addEventListener('pointerover', e => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (el === tip.target) return;
  if (tip.target && el && tip.target.contains(el) && !el.matches('[data-tip]')) return;
  const wasOpen = !tip.el.hidden;
  hideTip();
  if (!el) return;
  if (!S.tips) { if (!el.title && el.dataset.tip) el.title = el.dataset.tip; return; }
  if (el.title) el.removeAttribute('title');
  tip.target = el;
  tip.timer = setTimeout(() => { if (tip.target === el) showTip(el); }, wasOpen ? 0 : 450);
});
document.addEventListener('pointerout', e => { if (tip.target && (!e.relatedTarget || !tip.target.contains(e.relatedTarget))) hideTip(); });
document.addEventListener('pointerdown', hideTip, true);
addEventListener('scroll', hideTip, true);
addEventListener('blur', hideTip);
document.addEventListener('focusin', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el || !S.tips || !e.target.matches('button, [role="button"], .divider')) return;
  let keyboard = false; try { keyboard = e.target.matches(':focus-visible'); } catch (err) {}
  if (!keyboard) return; /* focus moved by a click or by the app: no tooltip */
  hideTip(); tip.target = el; tip.timer = setTimeout(() => showTip(el), 600);
});
document.addEventListener('focusout', hideTip);

/* ---------- §12 settings UI --------------------------------------------- */
/* Inline icon set on a 24-unit grid, stroke 1.9, round caps. Each entry's viewBox
   is tuned so the artwork's bounding box sits on the exact centre. */
const ICONS = {
  sun:     ['0 0 24 24', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'],
  moon:    ['-0.34 0.34 24 24', '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'],
  wave:    ['0 0 24 24', '<path d="M3 12h3l3-7 4 14 3-7h5"/>'],
  info:    ['0 0 24 24', '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'],
  hash:    ['0 0 24 24', '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'],
  shield:  ['0 0.25 24 24', '<path d="M12 3l8 3v6c0 4.8-3.4 8.4-8 9.5C7.4 20.4 4 16.8 4 12V6z"/>'],
  swap:    ['0 0 24 24', '<path d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4"/>'],
  refresh: ['0 0 24 24', '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5"/>'],
  check:   ['0.5 0 24 24', '<path d="m5 12 5 5L20 7"/>'],
  alert:   ['0 0 24 24', '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>'],
  note:    ['0 0 24 24', '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'],
  audio:   ['0 0 24 24', '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>'],
  undo:    ['0 0 24 24', '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"/>'],
  image:   ['0 0 24 24', '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-4.5-4.5L6 19"/>'],
  volume:  ['-0.36 0 24 24', '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="M15.5 8.7a4.6 4.6 0 0 1 0 6.6M18.6 5.6a9 9 0 0 1 0 12.8"/>'],
  mute:    ['0 0 24 24', '<path d="M11 5 6 9H2v6h4l5 4Z"/><path d="m16 9.5 6 6m0-6-6 6"/>'],
  x:       ['0 0 24 24', '<path d="M18 6 6 18M6 6l12 12"/>'],
  pin:     ['-0.5 0.5 24 24', '<path d="M15 3.5 20.5 9 17 10l-4 4 .5 4.5-2 2-4-4-5 5 5-5-4-4 2-2 4.5.5 4-4Z"/>'],
};
function icon(name, size) {
  const [vb, body] = ICONS[name];
  return `<svg viewBox="${vb}" width="${size || 13}" height="${size || 13}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

const SETTINGS = [
  { group: 'Appearance' },
  { key: 'theme', name: 'Theme', desc: 'Light or dark glass. Remembered in this browser.', pin: true },
  { key: 'motion', name: 'Motion', desc: 'Auto follows your system’s reduce-motion setting. Reduce keeps only the fades. Command: <code>MOTION auto|reduce|full</code>.' },
  { key: 'backdrop', name: 'Backdrop', desc: 'Your own image behind the glass, any photo up to 16 MB. It is resized to fit the screen and stored in this browser.' },
  { key: 'tips', name: 'Hover info', desc: 'Hover a control for half a second to see what it does. Off uses the browser’s plain tooltips. Command: <code>TIPS on|off</code>.' },
  { group: 'Machine' },
  { key: 'base', name: 'Display base', desc: 'Registers and memory as decimal or hexadecimal bytes. Also the DEC/HEX chip on the Machine panel.', pin: true },
  { key: 'divZero', name: '÷0 guard', desc: 'On: dividing by zero halts the CPU. Off: it yields 0, so long-running programs survive bad input.', pin: true },
  { key: 'defaultClock', name: 'Default clock', desc: 'Milliseconds per instruction, applied now and at every start. 0 = instant. <span data-hz></span>', pin: 'clock' },
  { key: 'clockSep', name: 'Per-tab clock', desc: 'On: each editor tab keeps its own clock. Off: every tab shares one. Command: <code>CLOCKSEP on|off</code>.' },
  { key: 'clockAuto', name: 'Auto clock switch', desc: 'On: switching tabs applies that tab’s clock. Only with Per-tab clock on. Command: <code>CLOCKAUTO on|off</code>.' },
  { group: 'Editor' },
  { key: 'lint', name: 'Syntax check', desc: 'Unknown instructions and wrong operand counts get red line numbers and an error bar as you type.', pin: true },
  { key: 'strict', name: 'Strict run', desc: 'Run refuses to start while the program still has syntax errors.', pin: true },
  { key: 'live', name: 'Live program', desc: 'Re-parse the editor as you type, so Step always runs what is on screen. Command: <code>LIVE on|off</code>.' },
  { group: 'Sound' },
  { key: 'sound', name: 'RAM beep', desc: 'A short note on every memory write — the pitch follows the value. Click to cycle waveforms.', pin: true },
  { key: 'volume', name: 'Beep volume', desc: 'Loudness of the RAM beep. The speaker button mutes without changing the waveform.', pin: true },
  { key: 'pitch', name: 'Beep pitch', desc: 'Base frequency: a stored 0 sounds at this pitch; higher bytes climb up to three octaves.', pin: true },
  { key: 'beepFile', name: 'Custom beep', desc: 'Your own sample for the RAM beep (≤ 1.5 MB), pitched by the stored value and added to the waveform cycle.' },
  { group: 'Data' },
  { key: 'reset', name: 'Reset settings', desc: 'Restore every setting to its default. Your program and saved scripts are kept.' },
];
function toggleBtn(key, iconName, onClick, tipText) {
  return h('button', { class: 'toggle', type: 'button', 'data-ctrl': key, 'data-tip': tipText || null, onclick: onClick },
    h('span', { class: 't-ico', html: icon(iconName) }), h('span', { class: 't-lbl' }));
}
function makeControl(key) {
  switch (key) {
    case 'theme': return toggleBtn(key, 'sun', () => setTheme(html.dataset.theme === 'dark' ? 'light' : 'dark'), 'Switch light / dark');
    case 'motion': return toggleBtn(key, 'wave', () => { const order = ['auto', 'reduce', 'full']; setSetting('motion', order[(order.indexOf(S.motion) + 1) % 3]); }, 'Cycle auto → reduce → full');
    case 'tips': return toggleBtn(key, 'info', () => setSetting('tips', !S.tips));
    case 'base': return toggleBtn(key, 'hash', () => setSetting('base', S.base === 'dec' ? 'hex' : 'dec'), 'Toggle decimal / hexadecimal');
    case 'divZero': return toggleBtn(key, 'shield', () => setSetting('divZero', !S.divZero));
    case 'clockSep': return toggleBtn(key, 'swap', () => setSetting('clockSep', !S.clockSep));
    case 'clockAuto': return toggleBtn(key, 'refresh', () => setSetting('clockAuto', !S.clockAuto));
    case 'lint': return toggleBtn(key, 'check', () => setSetting('lint', !S.lint));
    case 'strict': return toggleBtn(key, 'alert', () => setSetting('strict', !S.strict));
    case 'live': return toggleBtn(key, 'refresh', () => setSetting('live', !S.live));
    case 'sound': return toggleBtn(key, 'note', () => {
      const modes = audio.modes();
      const next = modes[(modes.indexOf(S.sound) + 1) % modes.length];
      if (next !== 'off' && !audio.ensure()) { toast('Audio is unavailable in this browser', 'err'); return; }
      setSetting('sound', next);
      if (next !== 'off') { audio.last = 0; audio.beep(64); }
    }, 'Cycle the waveform: off → sine → square → triangle → sawtooth');
    case 'volume': {
      const mute = h('button', { class: 'toggle icon-only', type: 'button', 'data-ctrl': 'muted', 'aria-label': 'Mute or unmute the RAM beep', 'data-tip': 'Mute / unmute', onclick: () => setSetting('muted', !S.muted) }, h('span', { class: 't-ico' }));
      const range = h('input', { type: 'range', min: '0', max: '100', step: '1', 'data-ctrl': 'volume', 'aria-label': 'RAM beep volume', 'data-tip': 'RAM beep volume' });
      range.addEventListener('input', () => setSetting('volume', parseFloat(range.value), true));
      return h('span', { class: 'mirror' }, mute, range);
    }
    case 'pitch': {
      const num = h('input', { type: 'number', class: 'num', min: '50', max: '2000', step: '1', 'data-ctrl': 'pitch', 'aria-label': 'RAM beep base frequency in hertz' });
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (!Number.isNaN(v)) setSetting('pitch', Math.round(clamp(v, 50, 2000)), true); });
      return h('span', { class: 'mirror' }, num, h('span', { class: 'unit', text: 'Hz' }));
    }
    case 'defaultClock': {
      const num = h('input', { type: 'number', class: 'num', min: '0', step: 'any', 'data-ctrl': 'defaultClock', 'aria-label': 'Default clock in milliseconds' });
      num.addEventListener('input', () => { const v = parseFloat(num.value); if (!Number.isNaN(v)) setSetting('defaultClock', Math.max(0, v), true); });
      return h('span', { class: 'mirror' }, num, h('span', { class: 'unit', text: 'ms' }));
    }
    case 'backdrop': return h('span', { class: 'mirror' },
      toggleBtn(key, 'image', pickBackdrop, 'Choose an image'),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remove the custom backdrop', 'data-tip': 'Remove the backdrop', html: icon('x', 11), onclick: () => setBackdrop(null) }));
    case 'beepFile': return h('span', { class: 'mirror' },
      toggleBtn(key, 'audio', pickBeepFile, 'Choose a sound file'),
      h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Remove the custom beep', 'data-tip': 'Remove the custom beep', html: icon('x', 11), onclick: () => setBeepFile(null) }));
    case 'reset': {
      let armed = null;
      const b = toggleBtn(key, 'undo', () => {
        if (armed) { clearTimeout(armed); armed = null; resetAllSettings(); return; }
        b.classList.add('danger'); b.querySelector('.t-lbl').textContent = 'Sure? click again';
        armed = setTimeout(() => { armed = null; b.classList.remove('danger'); b.querySelector('.t-lbl').textContent = 'Reset'; }, 3000);
      });
      b.querySelector('.t-lbl').textContent = 'Reset';
      return b;
    }
  }
  return null;
}
function syncControls(only) {
  const hzEl = $('[data-hz]');
  if (hzEl) hzEl.textContent = S.defaultClock === 0 ? '(instant)' : `(≈ ${S.defaultClock >= 1000 ? (1000 / S.defaultClock).toFixed(2) : Math.round(1000 / S.defaultClock)} Hz)`;
  $$('[data-ctrl]').forEach(el => {
    const key = el.dataset.ctrl;
    if (only && key !== only) return;
    const lbl = el.querySelector('.t-lbl'), ico = el.querySelector('.t-ico');
    const set = (on, text) => { el.classList.toggle('on', !!on); el.setAttribute('aria-pressed', !!on); if (lbl && text !== undefined) lbl.textContent = text; };
    switch (key) {
      case 'theme': { const dark = html.dataset.theme === 'dark'; set(false, dark ? 'dark' : 'light'); ico.innerHTML = icon(dark ? 'moon' : 'sun'); break; }
      case 'motion': set(S.motion !== 'auto', S.motion); break;
      case 'tips': set(S.tips, S.tips ? 'on' : 'off'); break;
      case 'base': set(S.base === 'hex', S.base.toUpperCase()); break;
      case 'divZero': set(S.divZero, S.divZero ? 'guard' : 'yield 0'); break;
      case 'clockSep': set(S.clockSep, S.clockSep ? 'separate' : 'linked'); break;
      case 'clockAuto': set(S.clockAuto, S.clockAuto ? 'auto' : 'manual'); el.classList.toggle('disabled', !S.clockSep); break;
      case 'lint': set(S.lint, S.lint ? 'on' : 'off'); break;
      case 'strict': set(S.strict, S.strict ? 'on' : 'off'); break;
      case 'live': set(S.live, S.live ? 'on' : 'off'); break;
      case 'sound': set(S.sound !== 'off', S.sound); break;
      case 'muted': set(S.muted); ico.innerHTML = icon(S.muted ? 'mute' : 'volume'); el.setAttribute('aria-pressed', S.muted); break;
      case 'volume': if (document.activeElement !== el) el.value = S.volume; break;
      case 'pitch': if (document.activeElement !== el) el.value = S.pitch; break;
      case 'defaultClock': if (document.activeElement !== el) el.value = fmtNum(S.defaultClock); break;
      case 'backdrop': set(backdropOn, backdropOn ? 'custom' : 'default'); break;
      case 'beepFile': set(!!audio.data, audio.data ? 'custom' : 'none'); break;
    }
  });
  ui.baseToggle.textContent = S.base.toUpperCase();
  ui.baseToggle.setAttribute('aria-pressed', S.base === 'hex');
}
function setSetting(key, value, fromSlider) {
  const prev = S[key];
  S[key] = value;
  saveSettings();
  switch (key) {
    case 'base': renderRegs(); renderMemory(true); renderNow(); break;
    case 'lint': lintNow(); break;
    case 'live': if (value && (cpu.halted || cycles === 0)) { parseProgram(); renderGutter(); renderNow(); } break;
    case 'tips': if (!value) hideTip(); break;
    case 'motion': html.dataset.motion = value === 'auto' ? '' : value; if (value === 'auto') delete html.dataset.motion; store.set('motion', value); break;
    case 'clockSep': if (!value) { for (const t in S.tabClocks) S.tabClocks[t] = run.speed; } else if (S.clockAuto) applySpeed(S.tabClocks[editorTabs.current]); syncClockUI(); break;
    case 'clockAuto': if (value && S.clockSep) applySpeed(S.tabClocks[editorTabs.current]); syncClockUI(); break;
    case 'defaultClock': setTabClock(editorTabs.current, value); break;
    case 'hostPace': byId('hostPaceNum').value = fmtNum(value); break;
    case 'hybridPace': byId('hybridPaceNum').value = fmtNum(value); break;
    case 'sound': if (value !== 'off') audio.ensure(); break;
    case 'volume': if (!fromSlider) break; /* fallthrough intended for live feedback */
    case 'muted': case 'pitch': if (S.sound !== 'off' && audio.ctx && key !== 'volume') { audio.last = 0; audio.beep(64); } break;
  }
  if (key !== 'defaultClock') syncControls();
  else syncControls('defaultClock');
  if (prev !== value && key === 'motion' && value === 'reduce') toast('Motion reduced: movement off, fades kept', 'ok', 2600);
}
function setTheme(t) {
  store.set('theme', t);
  if (html.dataset.theme === t) { syncControls('theme'); return; }
  /* Re-enable transitions once the new theme has painted (double rAF), with a
     timer as a backstop for pages where frames are paused. */
  const settle = () => {
    const off = () => html.classList.remove('theme-snap');
    requestAnimationFrame(() => requestAnimationFrame(off));
    setTimeout(off, 400);
  };
  let flipped = false;
  const flip = () => {
    if (flipped) return;
    flipped = true;
    html.classList.add('theme-snap');
    html.dataset.theme = t;
    syncControls('theme');
    settle();
  };
  if (document.startViewTransition && !reducedMotion() && document.visibilityState === 'visible') {
    try {
      const vt = document.startViewTransition(flip);
      vt.ready.catch(() => {});
      vt.finished.catch(() => {});
      /* If the page isn't rendering (a background tab), don't wait for the crossfade. */
      setTimeout(flip, 250);
      return;
    } catch (e) {}
  }
  flip();
}
byId('themeQuick').addEventListener('click', () => setTheme(html.dataset.theme === 'dark' ? 'light' : 'dark'));
ui.baseToggle.addEventListener('click', () => setSetting('base', S.base === 'dec' ? 'hex' : 'dec'));

function buildSettings() {
  const body = byId('settingsBody');
  body.replaceChildren();
  for (const row of SETTINGS) {
    if (row.group) { body.append(h('div', { class: 'sgroup', text: row.group })); continue; }
    const control = makeControl(row.key);
    const ctrl = h('div', { class: 'sctrl' }, control);
    if (row.pin) {
      const pinKey = row.pin === true ? row.key : row.pin;
      const b = h('button', { class: 'pin', type: 'button', 'data-pin': pinKey, 'aria-pressed': S.pins[pinKey] ? 'true' : 'false', 'aria-label': `Show the ${row.name} control in the footer bar`, 'data-tip': 'Pin to the footer bar', html: icon('pin'), onclick: () => setPin(pinKey, !S.pins[pinKey]) });
      ctrl.append(b);
    } else if (!(control.lastElementChild && control.lastElementChild.classList.contains('icon-btn'))) {
      ctrl.append(h('span', { class: 'pin-spacer', 'aria-hidden': 'true' }));
    }
    body.append(h('div', { class: 'srow' }, h('div', { class: 'sinfo' }, h('div', { class: 'sname', text: row.name }), h('div', { class: 'sdesc', html: row.desc })), ctrl));
  }
}
function setPin(key, on) {
  S.pins[key] = !!on;
  saveSettings();
  $$('.pin').forEach(b => { if (b.dataset.pin === key) b.setAttribute('aria-pressed', !!on); });
  renderPins();
}
function renderPins() {
  ui.footPins.replaceChildren();
  for (const key of PIN_ORDER) {
    if (key === 'clock' || !S.pins[key]) continue;
    const c = makeControl(key);
    if (c) ui.footPins.append(c);
  }
  ui.clockCtrl.hidden = !S.pins.clock;
  syncControls();
}
function resetAllSettings() {
  const keepSizes = { colEditor: S.colEditor, rowManual: S.rowManual };
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, JSON.parse(JSON.stringify(DEFAULTS)), keepSizes);
  saveSettings.flush(); store.set('settings', JSON.stringify(S));
  setBackdrop(null); setBeepFile(null);
  setTheme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  delete html.dataset.motion; store.del('motion');
  applySpeed(S.tabClocks[editorTabs.current]);
  byId('hostPaceNum').value = S.hostPace; byId('hybridPaceNum').value = S.hybridPace;
  document.body.classList.toggle('manual-collapsed', false);
  byId('manualCollapse').setAttribute('aria-expanded', 'true');
  buildSettings(); renderPins(); syncClockUI(); lintNow(); renderRegs(); renderMemory(true); renderNow();
  toast('Settings restored to defaults', 'ok', 2600);
}

/* backdrop & custom beep. A stored "" means the user removed it; null means
   never set, so one saved by a pre-release build is used. */
function storedBlob(key) {
  const v = store.get(key);
  if (v === null) return store.legacy(key);
  return v || null;
}
let backdropOn = false;
function applyBackdrop(src) {
  backdropOn = !!src;
  if (src) { document.body.style.setProperty('--backdrop-img', `url("${src.replace(/"/g, '%22')}")`); html.classList.add('has-backdrop'); }
  else { document.body.style.removeProperty('--backdrop-img'); html.classList.remove('has-backdrop'); }
}
function setBackdrop(src) {
  if (src) { try { localStorage.setItem('mica:backdrop', src); } catch (e) { toast('That image is too large to store', 'err'); return false; } }
  else store.set('backdrop', '');
  applyBackdrop(src);
  syncControls('backdrop');
  return true;
}
function pickFile(accept, maxBytes, onData) {
  const input = h('input', { type: 'file', accept });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > maxBytes) { toast(`That file is ${(f.size / 1048576).toFixed(1)} MB — the limit is ${(maxBytes / 1048576).toFixed(1)} MB`, 'err'); return; }
    const r = new FileReader();
    r.onload = () => onData(String(r.result));
    r.readAsDataURL(f);
  });
  input.click();
}
/* Backdrops are downscaled once, to a 2,560 px longest edge: a 12-megapixel photo
   decodes to about 48 MB of pixels, this to under 20 MB, and stores far smaller.
   Images with transparency stay PNG; everything else becomes a JPEG. */
function shrinkImage(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, hgt = img.naturalHeight, k = Math.min(1, 2560 / Math.max(w, hgt));
      if (k === 1 && dataUrl.length < 900000) { resolve(dataUrl); return; }
      let alpha = false;
      if (!/^data:image\/jpe?g/i.test(dataUrl)) {
        const probe = h('canvas', { width: 32, height: 32 }).getContext('2d');
        probe.drawImage(img, 0, 0, 32, 32);
        const d = probe.getImageData(0, 0, 32, 32).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
      }
      const c = h('canvas', { width: Math.round(w * k), height: Math.round(hgt * k) });
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      const out = alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
      resolve(out.length < dataUrl.length ? out : dataUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
function pickBackdrop() {
  pickFile('image/*', 16 * 1048576, async data => {
    const small = await shrinkImage(data);
    if (setBackdrop(small)) toast('Backdrop set', 'ok', 2000);
  });
}
/* A large backdrop (for instance one carried over from a pre-release build) is
   slimmed once, shortly after start-up, then the lighter copy is used from then on. */
async function slimBackdrop() {
  const cur = storedBlob('backdrop');
  if (!cur || !cur.startsWith('data:image') || cur.length < 900000) return;
  const small = await shrinkImage(cur);
  if (small === cur) return;
  const img = new Image(); img.src = small;
  try { await img.decode(); } catch (e) { return; }
  try { localStorage.setItem('mica:backdrop', small); } catch (e) {}
  applyBackdrop(small);
}
async function setBeepFile(data) {
  if (data) { try { localStorage.setItem('mica:beepfile', data); } catch (e) { toast('That sound is too large to store', 'err'); return; } }
  else store.set('beepfile', '');
  const ok = await audio.loadSample(data);
  if (data && !ok) { toast('Could not decode that sound file', 'err'); store.set('beepfile', ''); audio.data = null; }
  if (!audio.data && S.sound === 'custom') setSetting('sound', 'off');
  if (data && ok) { setSetting('sound', 'custom'); audio.last = 0; audio.beep(64); }
  syncControls();
}
function pickBeepFile() { if (!audio.ensure()) { toast('Audio is unavailable in this browser', 'err'); return; } pickFile('audio/*', 1.5 * 1048576, data => setBeepFile(data)); }
byId('hostPaceNum').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { S.hostPace = Math.max(0, v); saveSettings(); } });
byId('hybridPaceNum').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) { S.hybridPace = Math.max(0, v); saveSettings(); } });
/* Browsers only allow audio after a gesture: create the context on the first click anywhere. */
document.addEventListener('pointerdown', () => { if (S.sound !== 'off') { audio.ensure(); if (S.sound === 'custom') audio.decode(); } }, { once: true, capture: true });

/* ---------- §13 windows: floating panels, dividers, manual collapse ----- */
const panels = { editor: $('[data-panel="editor"]'), machine: $('[data-panel="machine"]'), manual: $('[data-panel="manual"]') };
const homeOf = p => p.dataset.home;
const slotOf = p => p.dataset.slot || homeOf(p);
const slotRects = {};
function captureSlots() { for (const k in panels) { const p = panels[k]; if (!p.classList.contains('floating')) slotRects[slotOf(p)] = p.getBoundingClientRect(); } }
function placeInSlot(p, slot) {
  p.classList.remove('floating');
  p.style.position = p.style.left = p.style.top = p.style.width = p.style.height = p.style.zIndex = '';
  p.style.gridArea = slot === homeOf(p) ? '' : slot;
  p.dataset.slot = slot;
}
let floatZ = 300;
function floatPanel(p, nudge) {
  if (p.classList.contains('floating') || !wideScreen.matches) return;
  const r = p.getBoundingClientRect();
  p.classList.add('floating');
  p.style.position = 'fixed';
  p.style.left = r.left + (nudge ? 24 : 0) + 'px';
  p.style.top = r.top + (nudge ? 24 : 0) + 'px';
  p.style.width = r.width + 'px';
  p.style.height = r.height + 'px';
  p.style.zIndex = ++floatZ;
}
function snapToSlot(p, slot) {
  const from = p.getBoundingClientRect();
  const cur = slotOf(p);
  if (slot !== cur) for (const k in panels) {
    const q = panels[k];
    if (q === p || slotOf(q) !== slot) continue;
    if (q.classList.contains('floating')) q.dataset.slot = cur; else placeInSlot(q, cur);
  }
  placeInSlot(p, slot);
  if (!reducedMotion()) {
    const to = p.getBoundingClientRect();
    const dx = from.left - to.left, dy = from.top - to.top;
    if (to.width && to.height && (dx || dy || from.width !== to.width || from.height !== to.height)) {
      p.style.transformOrigin = '0 0';
      p.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.23,1,.32,1)' });
    }
  }
  captureSlots();
  fitMemory();
}
function snapHome(p) { if (!p.classList.contains('floating') && slotOf(p) === homeOf(p)) return; snapToSlot(p, homeOf(p)); }
function nearestSlot(left, top) {
  let best = null, bestD = 90;
  for (const k in slotRects) { const r = slotRects[k]; const d = Math.hypot(left - r.left, top - r.top); if (d < bestD) { bestD = d; best = k; } }
  return best;
}
const ghost = byId('snapGhost');
function showGhost(slot) {
  const r = slotRects[slot];
  if (!r) { ghost.hidden = true; return; }
  ghost.hidden = false;
  ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px'; ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
}
$$('.panel-head[data-drag]').forEach(head => {
  const panel = head.parentElement;
  head.addEventListener('dblclick', e => { if (e.target.closest('button, select, input, .tabs')) return; if (wideScreen.matches) snapHome(panel); });
  head.addEventListener('pointerdown', e => {
    if (!wideScreen.matches || e.button !== 0 || e.target.closest('button, select, input, .tabs, .chip')) return;
    const startX = e.clientX, startY = e.clientY;
    let dragging = false, offX = 0, offY = 0;
    const move = ev => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
        dragging = true;
        captureSlots();
        hideTip();
        if (!panel.classList.contains('floating')) floatPanel(panel, false);
        panel.classList.add('dragging');
        panel.style.zIndex = ++floatZ;
        const r = panel.getBoundingClientRect();
        offX = startX - r.left; offY = startY - r.top;
        try { head.setPointerCapture(ev.pointerId); } catch (err) {}
      }
      const left = ev.clientX - offX, top = ev.clientY - offY;
      panel.style.left = left + 'px'; panel.style.top = top + 'px';
      const slot = nearestSlot(left, top);
      if (slot) showGhost(slot); else ghost.hidden = true;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      ghost.hidden = true;
      if (!dragging) return;
      panel.classList.remove('dragging');
      const r = panel.getBoundingClientRect();
      const slot = nearestSlot(r.left, r.top);
      if (slot) snapToSlot(panel, slot);
      captureSlots();
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
});
const syncCanFloat = () => document.body.classList.toggle('can-float', wideScreen.matches);
wideScreen.addEventListener('change', syncCanFloat);
syncCanFloat();

/* dividers */
/* While a divider moves, the elements that are expensive to re-flow keep their
   width (a long program in an editor, the 1,024-cell grid, the logs); the
   containers clip or pad them, and everything settles once on release. */
const FROZEN = () => [editors.asm.el, editors.host.el, editors.hybrid.el, tty.el, byId('hostOutput'), byId('hybridOutput')];
function freezeWidths(on) {
  for (const el of FROZEN()) {
    if (on) {
      const w = el.getBoundingClientRect().width;
      if (w > 0) { el.style.width = w + 'px'; el.style.flex = 'none'; }
    } else if (el.style.width) { el.style.width = ''; el.style.flex = ''; }
  }
}
const MIN_EDITOR = 320, MIN_MACHINE = 440, MIN_MANUAL = 80, MIN_TOP = 300;
function colMax() { return document.body.clientWidth - 24 - 12 - MIN_MACHINE; }
function rowMax() { return document.body.clientHeight - MIN_TOP - 120; }
function setCol(px, persist) {
  if (px == null) { document.body.style.removeProperty('--col-editor'); if (persist) { S.colEditor = null; saveSettings(); } return; }
  px = clamp(px, MIN_EDITOR, Math.max(MIN_EDITOR, colMax()));
  document.body.style.setProperty('--col-editor', px + 'px');
  if (persist) { S.colEditor = px; saveSettings(); }
}
function setRow(px, persist) {
  if (px == null) { document.body.style.removeProperty('--row-manual'); if (persist) { S.rowManual = null; saveSettings(); } return; }
  px = clamp(px, MIN_MANUAL, Math.max(MIN_MANUAL, rowMax()));
  document.body.style.setProperty('--row-manual', px + 'px');
  if (persist) { S.rowManual = px; saveSettings(); }
}
function wireDivider(div, vertical) {
  div.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = vertical ? e.clientX : e.clientY;
    /* All layout reads happen here, once; a move only writes one custom property. */
    const startSize = vertical ? panels.editor.getBoundingClientRect().width : panels.manual.getBoundingClientRect().height;
    const lo = vertical ? MIN_EDITOR : MIN_MANUAL;
    const hi = Math.max(lo, vertical ? colMax() : rowMax());
    const prop = vertical ? '--col-editor' : '--row-manual';
    let size = Math.round(startSize);
    if (vertical) freezeWidths(true);
    div.classList.add('active');
    document.body.classList.add('resizing', vertical ? 'resizing-v' : 'resizing-h');
    try { div.setPointerCapture(e.pointerId); } catch (err) {}
    hideTip();
    const move = ev => {
      const d = (vertical ? ev.clientX : ev.clientY) - start;
      const next = Math.round(clamp(vertical ? startSize + d : startSize - d, lo, hi));
      if (next === size) return;
      size = next;
      document.body.style.setProperty(prop, size + 'px');
    };
    const up = () => {
      div.removeEventListener('pointermove', move); div.removeEventListener('pointerup', up); div.removeEventListener('pointercancel', up);
      div.classList.remove('active');
      document.body.classList.remove('resizing', 'resizing-v', 'resizing-h');
      if (vertical) freezeWidths(false);
      if (vertical) S.colEditor = size; else S.rowManual = size;
      saveSettings();
      captureSlots(); fitMemory();
    };
    div.addEventListener('pointermove', move); div.addEventListener('pointerup', up); div.addEventListener('pointercancel', up);
  });
  div.addEventListener('dblclick', () => { if (vertical) setCol(null, true); else setRow(null, true); captureSlots(); fitMemory(); });
  div.addEventListener('keydown', e => {
    const step = e.shiftKey ? 64 : 16;
    let d = 0;
    if (vertical && e.key === 'ArrowLeft') d = -step; else if (vertical && e.key === 'ArrowRight') d = step;
    else if (!vertical && e.key === 'ArrowUp') d = step; else if (!vertical && e.key === 'ArrowDown') d = -step;
    if (!d) return;
    e.preventDefault();
    if (vertical) setCol(panels.editor.getBoundingClientRect().width + d, true); else setRow(panels.manual.getBoundingClientRect().height + d, true);
    captureSlots(); fitMemory();
  });
}
wireDivider(byId('dividerV'), true);
wireDivider(byId('dividerH'), false);
let resizeFrame = 0;
addEventListener('resize', () => {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (S.colEditor != null) setCol(S.colEditor);
    if (S.rowManual != null) setRow(S.rowManual);
    captureSlots(); fitMemory();
  });
});
function setManualCollapsed(on) {
  document.body.classList.toggle('manual-collapsed', on);
  byId('manualCollapse').setAttribute('aria-expanded', !on);
  byId('manualCollapse').setAttribute('aria-label', on ? 'Expand the manual' : 'Collapse the manual');
  S.manualCollapsed = on; saveSettings();
  captureSlots(); fitMemory();
}
byId('manualCollapse').addEventListener('click', () => setManualCollapsed(!document.body.classList.contains('manual-collapsed')));

/* TTY height: drag its header */
const ttyEl = $('.tty');
if (S.ttyHeight) ttyEl.style.height = clamp(S.ttyHeight, 80, 520) + 'px';
byId('ttyHead').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const head = e.currentTarget, startY = e.clientY, startH = ttyEl.getBoundingClientRect().height;
  try { head.setPointerCapture(e.pointerId); } catch (err) {}
  document.body.classList.add('resizing', 'resizing-h');
  hideTip();
  const move = ev => { ttyEl.style.height = clamp(startH - (ev.clientY - startY), 80, 520) + 'px'; };
  const up = () => {
    head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
    document.body.classList.remove('resizing', 'resizing-h');
    S.ttyHeight = Math.round(ttyEl.getBoundingClientRect().height); saveSettings(); fitMemory();
  };
  head.addEventListener('pointermove', move); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
});

/* ---------- §14 keyboard ----------------------------------------------- */
document.addEventListener('keydown', e => {
  const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const mod = e.metaKey || e.ctrlKey;
  if (mod && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (!byId('scriptModal').hidden) { confirmSave(); return; }
    openLibrary(editorTabs.current);
    return;
  }
  if (mod && e.key === 'Enter') {
    if (e.target === ui.ttyInput) return;
    e.preventDefault();
    if (editorTabs.current === 'host') runHostScript();
    else if (editorTabs.current === 'hybrid') runHybridScript();
    else runButton();
    return;
  }
  if (e.key === 'Escape') {
    const m = openModalEl();
    if (m) { e.preventDefault(); closeModal(m); return; }
    if (!drawer.hidden) { e.preventDefault(); openSettings(false); return; }
    if (!ui.toast.hidden) { hideToast(); }
  }
  if (typing) return;
  if (e.key === '/' && !mod && !e.altKey) {
    e.preventDefault();
    if (document.body.classList.contains('manual-collapsed')) setManualCollapsed(false);
    byId('refSearch').focus();
    byId('refSearch').select();
    return;
  }
  if (e.key === 'F10') { e.preventDefault(); stepExecution(); }
  else if (e.key === 'Escape') { if (run.timer) { e.preventDefault(); pause(); } }
  else if (e.shiftKey && e.key === 'F5') { e.preventDefault(); resetCPU(); }
});
ui.btnRun.addEventListener('click', runButton);
ui.btnStep.addEventListener('click', stepExecution);
ui.btnPause.addEventListener('click', () => pause());
ui.btnReset.addEventListener('click', () => resetCPU());
addEventListener('error', e => { if (e && e.message) toast('Unexpected error: ' + e.message, 'err'); });

/* ---------- §15 boot --------------------------------------------------- */
(function boot() {
  buildRegs();
  buildMemory();
  buildReference();
  buildSettings();
  renderPins();
  wireClockInputs();

  /* editors: saved text, else a pre-release build's, else the first example */
  editors.asm.setValue(store.get('program') ?? store.legacy('program-v1') ?? EXAMPLES.counter);
  prevLines = editors.asm.el.value.split('\n');
  const host = store.get('host') ?? store.legacy('host-v1'); if (host !== null) editors.host.setValue(host);
  const hybrid = store.get('hybrid') ?? store.legacy('hybrid-v1'); if (hybrid !== null) editors.hybrid.setValue(hybrid);
  const exampleMatch = exampleFor(editors.asm.el.value);
  byId('exampleSelect').value = exampleMatch || '';
  refreshSavedSelects();

  /* appearance */
  if (S.motion !== 'auto') { html.dataset.motion = S.motion; store.set('motion', S.motion); }
  const bd = storedBlob('backdrop'); if (bd) applyBackdrop(bd);
  const bf = storedBlob('beepfile'); if (bf) audio.data = bf;
  if (S.manualCollapsed) setManualCollapsed(true);
  if (S.colEditor != null) setCol(S.colEditor);
  if (S.rowManual != null) setRow(S.rowManual);
  byId('hostPaceNum').value = fmtNum(S.hostPace);
  byId('hybridPaceNum').value = fmtNum(S.hybridPace);

  /* clocks */
  applySpeed(S.clockSep ? S.tabClocks.asm : S.tabClocks.asm);
  syncClockUI();
  syncControls();

  editors.asm.measure();
  resetCPU();
  lintNow();
  scanForeign();
  fitMemory();
  let fitFrame = 0;
  new ResizeObserver(() => { if (!fitFrame && !document.body.classList.contains('resizing')) fitFrame = requestAnimationFrame(() => { fitFrame = 0; fitMemory(); }); }).observe(mem.scroll);
  captureSlots();

  requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('preload')));
  setTimeout(() => html.classList.remove('boot'), 900);
  setTimeout(slimBackdrop, 1500);
  if (store.legacy('theme') !== null && store.get('settings') === null) toast('Welcome to Mica — your previous settings and program came along', 'ok', 4200);
  saveSettings();
})();

})();
