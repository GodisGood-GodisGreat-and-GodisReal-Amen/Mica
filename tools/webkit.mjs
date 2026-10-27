/* Runs plans in WebKit, Safari's engine, through tools/webshot.swift (macOS only).
   The binary is compiled once into node_modules/.cache/mica/ and again whenever
   the Swift source changes. */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'tools', 'webshot.swift');

export function webshotBinary() {
  if (process.platform !== 'darwin') throw new Error('WebKit runs need macOS (they use the system WebKit through Swift)');
  const dir = path.join(ROOT, 'node_modules', '.cache', 'mica');
  const bin = path.join(dir, 'webshot');
  if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(SOURCE).mtimeMs) {
    mkdirSync(dir, { recursive: true });
    console.error('compiling tools/webshot.swift…');
    execFileSync('swiftc', ['-O', '-o', bin, SOURCE, '-framework', 'Cocoa', '-framework', 'WebKit'], { stdio: 'inherit' });
  }
  return bin;
}

/* Resolves to webshot's output: one "[i] value" line per step that logs. */
export function webshot(page, plan, outDir) {
  const bin = webshotBinary();
  const tmp = mkdtempSync(path.join(tmpdir(), 'mica-webshot-'));
  const planFile = path.join(tmp, 'plan.json');
  writeFileSync(planFile, JSON.stringify(plan));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [page, planFile, outDir || tmp], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('exit', code => {
      rmSync(tmp, { recursive: true, force: true });
      if (code === 0) resolve(out);
      else reject(new Error(`webshot stopped with code ${code}${code === 3 ? ' (timed out)' : ''}\n${out}`));
    });
  });
}
