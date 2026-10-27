#!/usr/bin/env node
/* Quick checks that need only Node and npm install (no browser):

   - every JavaScript file parses
   - mica.html is exactly what src/ builds to (the deflated kernel is compared
     after inflating, so a different zlib can never fail the check)
   - the version in package.json is the newest entry in CHANGELOG.md
   - every relative link and image in the Markdown files points at a file */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { build, ROOT } from './build.mjs';

const problems = [];
const rel = p => path.relative(ROOT, p);

/* 1. syntax */
const scripts = ['src/examples.js', 'src/app.js', 'test/suite.js', 'test/run.mjs', 'tools/perf/bench.js',
  ...readdirSync(path.join(ROOT, 'tools')).filter(f => f.endsWith('.mjs')).map(f => 'tools/' + f)];
for (const f of scripts) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); }
  catch (e) { problems.push(`${f} does not parse:\n${String(e.stderr).trim()}`); }
}

/* 2. the committed build */
const unpack = html => html.replace(/PACKED_EXAMPLES=\{[^}]*\}/, block =>
  block.replace(/"([A-Za-z0-9+/]+=*)"/g, (m, b64) => b64.length < 64 ? m : JSON.stringify(inflateRawSync(Buffer.from(b64, 'base64')).toString())));
const committed = path.join(ROOT, 'mica.html');
if (!existsSync(committed)) problems.push('mica.html is missing: run npm run build');
else {
  const want = unpack(await build()), got = unpack(readFileSync(committed, 'utf8'));
  if (want !== got) {
    let i = 0;
    while (i < want.length && want[i] === got[i]) i++;
    problems.push(`mica.html is not what src/ builds to (first difference at character ${i}): run npm run build`);
  }
}

/* 3. version */
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const newest = /^## (\d+\.\d+\.\d+)/m.exec(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'));
if (!newest || newest[1] !== version) problems.push(`package.json says ${version}, CHANGELOG.md starts with ${newest ? newest[1] : 'no version'}`);

/* 4. links in the docs */
const docs = [...readdirSync(ROOT).filter(f => f.endsWith('.md')), ...readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];
for (const doc of docs) {
  const file = path.join(ROOT, doc);
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const dest = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]));
    if (!existsSync(dest)) problems.push(`${doc} links to ${target}, which does not exist (${rel(dest)})`);
  }
}

if (problems.length) {
  console.error(problems.map(p => '✗ ' + p).join('\n'));
  process.exit(1);
}
console.log(`✓ ${scripts.length} scripts parse · mica.html matches src/ · version ${version} · links in ${docs.length} documents resolve`);
