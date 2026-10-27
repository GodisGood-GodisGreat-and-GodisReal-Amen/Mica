#!/usr/bin/env node
/* Builds mica.html, the whole app in one file, from src/.

   CSS and JavaScript are minified with esbuild; the HTML gets a small built-in
   pass that never touches <textarea>, <pre>, <script> or <style> contents.
   The instruction set lives in template strings, so the CPU tab keeps showing
   readable code. The kernel example ships deflated (raw deflate + base64) and
   the browser unpacks it the first time it is opened.

     node tools/build.mjs              minified build
     node tools/build.mjs --readable   readable build, for debugging (NO_MINIFY=1 works too) */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = name => readFileSync(path.join(ROOT, 'src', name), 'utf8');

const PROTECTED = /<(textarea|pre|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const QUOTED_OR_SPACE = /("[^"]*"|'[^']*')|\s+/g;

export function minifyHtml(s) {
  let out = '', last = 0;
  for (const m of s.matchAll(PROTECTED)) {
    out += squeeze(s.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + squeeze(s.slice(last));
}

/* Whitespace-only text containing a line break disappears; other runs of
   whitespace in text become one space; inside tags only the gaps between
   attributes are touched, never a quoted value. */
function squeeze(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '').split(/(<[^>]*>)/).map(part => {
    if (part.startsWith('<')) return part.replace(QUOTED_OR_SPACE, (m, quoted) => quoted || ' ').replaceAll(' >', '>');
    if (!part.trim()) return part.includes('\n') ? '' : part;
    return part.replace(/\s+/g, ' ');
  }).join('');
}

/* Same hash as textHash() in app.js: FNV-1a over UTF-16 code units, base 36, plus the length. */
export function textHash(t) {
  let x = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); }
  return (x >>> 0).toString(36) + ':' + t.length;
}

/* Moves large examples out of EXAMPLES into PACKED_EXAMPLES as raw deflate +
   base64. The code gets a placeholder for each payload and the payload goes in
   after minification: zlib's output differs between machines, and esbuild picks
   its short names from the characters of the whole input, so a payload in the
   input would rename half the app from one machine to the next. */
function packExamples(js, names = ['kernel']) {
  const entries = [], payloads = new Map();
  for (const name of names) {
    const open = `${name}: \``;
    const start = js.indexOf(open) + open.length;
    const end = js.indexOf('`,', start);
    if (start < open.length || end < 0) throw new Error(`example "${name}" not found in src/examples.js`);
    const text = js.slice(start, end);
    if (text.includes('${') || text.includes('\\')) throw new Error(`example "${name}" must not contain \${ or backslashes`);
    const token = `__PACKED_${name.toUpperCase()}__`;
    payloads.set(token, deflateRawSync(Buffer.from(text), { level: 9, memLevel: 9 }).toString('base64'));
    entries.push(`${name}: ['${token}', '${textHash(text)}']`);
    js = js.slice(0, start - 1) + 'null' + js.slice(end + 1);
  }
  return { js: js + `\nconst PACKED_EXAMPLES = { ${entries.join(', ')} };\n`, payloads };
}

export async function build({ readable = false } = {}) {
  const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  let head = src('head.html');
  let css = src('style.css');
  let body = src('body.html').replaceAll('__VERSION__', version);
  let js = src('examples.js') + '\n' + src('app.js');
  if (!readable) {
    const { transformSync } = await import('esbuild');
    const min = (code, loader) => transformSync(code, { loader, minify: true, charset: 'utf8', legalComments: 'none' }).code.replace(/\n+$/, '');
    const packed = packExamples(src('examples.js'));
    js = min(packed.js + '\n' + src('app.js'), 'js');
    for (const [token, payload] of packed.payloads) {
      if (js.split(token).length !== 2) throw new Error(`${token} should appear once in the minified code`);
      js = js.replace(token, payload);
    }
    css = min(css, 'css');
    head = minifyHtml(head.replace(/(<script>)([\s\S]*?)(<\/script>)/g, (m, open, code, close) => open + min(code, 'js') + close));
    body = minifyHtml(body);
  }
  return head.replace(/\n+$/, '') + '\n' + css + '\n' + body.replace(/^\n+|\n+$/g, '') + '\n<script>\n' + js + '\n</script>\n</body>\n</html>\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const readable = process.argv.includes('--readable') || process.env.NO_MINIFY === '1';
  try {
    const html = await build({ readable });
    writeFileSync(path.join(ROOT, 'mica.html'), html);
    console.log(`built mica.html (${readable ? 'readable' : 'minified'}): ${Buffer.byteLength(html).toLocaleString('en')} bytes`);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') console.error('esbuild is missing: run npm install first (or build the readable version with --readable)');
    else console.error(e.message || e);
    process.exit(1);
  }
}
