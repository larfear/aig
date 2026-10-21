import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const [major, minor] = process.versions.node.split('.').map(Number);
const checks = [{ name: 'Node 24.14+', ok: major === 24 && minor >= 14, detail: process.version }];
for (const [command, args] of [['npm', ['--version']], ['git', ['--version']], ['openssl', ['version']]]) {
  try {
    const detail = execFileSync(command, args, { encoding: 'utf8', cwd: root }).trim();
    checks.push({ name: command, ok: true, detail });
  } catch {
    checks.push({ name: command, ok: false, detail: 'not available' });
  }
}
for (const [name, expected] of Object.entries(pkg.devDependencies)) {
  let actual = 'not installed';
  try {
    actual = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch { /* Report missing dependencies without exposing environment variables. */ }
  checks.push({ name, ok: actual === expected, detail: `${actual} (expected ${expected})` });
}
const report = {
  checked_at: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  scope: 'local development tools only; no network or production checks',
  ok: checks.every(check => check.ok),
  checks,
};
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
if (process.argv.includes('--write')) {
  const target = resolve(root, '.local/environment.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log('Saved .local/environment.json');
}
process.exitCode = report.ok ? 0 : 1;
