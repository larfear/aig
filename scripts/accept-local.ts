import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { parseResource } from '../src/core/resource.ts';
import type { Resource } from '../src/core/resource.ts';
import { localDirectory, root, writeJSON } from './lib/preflight.ts';
import { startLocalHosting } from './lib/local-host.ts';
import { preparePublisher } from './lib/publisher.ts';

const execute = promisify(execFile);
const clientEnv = { ...process.env };
for (const key of Object.keys(clientEnv)) {
  if (/^(CLOUDFLARE_|CF_|WRANGLER_|AIG_)/.test(key)) delete clientEnv[key];
}
let host: Awaited<ReturnType<typeof startLocalHosting>> | undefined;
let directory: string | undefined;
let runtime: string | undefined;
const phases: unknown[] = [];
const report: Record<string, unknown> = { ok: false, scope: 'generic publisher local synthetic rehearsal; DOS/public/X NOT_RUN', phases };
try {
  const { values } = parseArgs({ options: { directory: { type: 'string', default: '.local/publisher-acceptance' } } });
  const parent = localDirectory(values.directory);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  directory = await mkdtemp(join(parent, 'run-'));
  runtime = join(directory, 'runtime');
  const publisher_id = `urn:aig:publisher:local-${randomUUID()}`;
  const prepared = await preparePublisher(runtime, publisher_id);
  host = await startLocalHosting(runtime, 'public');
  const fixture = JSON.parse(await readFile(join(root, 'examples/resources/demo-announcement-001.json'), 'utf8'));
  const id = `acceptance-${randomUUID()}`;
  const original = parseResource({ ...fixture, id, publisher: { id: publisher_id, name: '【合成联调】通用发布工具' },
    source: { system: 'generic-local-publisher', record_id: id, public_url: `https://publisher.example.invalid/${id}` },
    published_at: new Date().toISOString(), updated_at: new Date().toISOString(), synthetic: true,
    representations: [{ media_type: 'text/plain', derivation: 'original',
      content_text: '【合成联调】  首尾空白\r\n中文 🌐 e\u0301\t\n' + '完整正文 '.repeat(2000) + '\n  ' }] });
  const send = async (resource: Resource, name: string) => {
    assert.equal(resource.synthetic, true, 'Rehearsal only sends synthetic resources');
    const path = join(directory!, 'inputs', `${name}.json`); await writeJSON(path, resource);
    const output = await execute(process.execPath, [join(root, 'scripts/demo-publish.ts'), '--file', path,
      '--url', host!.url, '--credentials', prepared.credentialPath], { cwd: root, env: clientEnv, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(output.stdout);
  };
  const read = async (resource: Resource, phase: string) => {
    const path = join(directory!, 'expected', `${phase}.json`);
    await writeJSON(path, { schema_version: 'aig-reader-expectation/1', origin: new URL(host!.url).origin,
      gateway_synthetic: false, resources: [resource] });
    await writeJSON(join(directory!, 'origin.json'), { origin: new URL(host!.url).origin });
    // A distinct read-only process receives no publisher credential or database binding.
    const output = await execute(process.execPath, [join(root, 'scripts/check-reader.ts'), '--expect', path],
      { cwd: root, env: clientEnv, maxBuffer: 2 * 1024 * 1024 });
    const result = JSON.parse(output.stdout); assert.equal(result.ok, true);
    phases.push({ phase, ok: true, reader: result, expectation: relative(root, path) });
  };
  assert.equal((await send(original, 'publish')).outcome, 'stored');
  assert.equal((await send(original, 'retry')).outcome, 'unchanged');
  await read(original, 'published');
  const conflict = structuredClone(original); conflict.representations[0]!.content_text += '【合成冲突】';
  await assert.rejects(send(conflict, 'conflict'), (error: unknown) =>
    (error as { stderr?: string }).stderr?.trim() === 'AIG HTTP 409');
  const updated = parseResource({ ...structuredClone(original), revision: 2, updated_at: new Date().toISOString(),
    representations: [{ media_type: 'text/plain', derivation: 'original', content_text: '【合成联调更新】\r\n  原文 🌐 e\u0301\t\n  ' }] });
  assert.equal((await send(updated, 'update')).outcome, 'stored');
  await read(updated, 'updated');
  await host.stop(); host = undefined;
  host = await startLocalHosting(runtime, 'public');
  await read(updated, 'restarted');
  const gone = parseResource({ ...structuredClone(updated), revision: 3, updated_at: new Date().toISOString(),
    status: 'withdrawn', withdrawal_reason: '【合成联调】主动撤回', representations: [] });
  assert.equal((await send(gone, 'withdraw')).outcome, 'stored');
  await read(gone, 'withdrawn');
  const old = await send(original, 'old-retry');
  assert.deepEqual([old.outcome, old.current_revision, old.current_status], ['unchanged', 3, 'withdrawn']);
  await read(gone, 'old-retry-remains-withdrawn');
  report.ok = true;
  report.publisher_id = publisher_id;
  report.gateway_mode = 'public'; report.all_input_content_synthetic = true;
  report.checks = ['publisher CLI → loopback Worker → local D1 → separate read-only CLI', 'full multilingual original text',
    'idempotent retry and rejected conflicting revision', 'update', 'D1 restart persistence', '410 withdrawal and old retry without restoration'];
} catch {
  report.error = 'Local acceptance incomplete; inspect the completed phases. No cloud deployment or X send occurred.';
  process.exitCode = 1;
} finally {
  try { if (host) await host.stop(); report.local_server_stopped = true; }
  catch { report.ok = false; report.local_server_stopped = false; process.exitCode = 1; }
  if (runtime) await rm(runtime, { recursive: true, force: true });
  report.runtime_database_and_keys_removed = Boolean(runtime);
  report.checked_at = new Date().toISOString();
  if (directory) {
    await writeJSON(join(directory, 'report.json'), report);
    await writeJSON(join(directory, '..', 'latest.json'), { ...report, report: relative(root, join(directory, 'report.json')) });
  }
  console.log(JSON.stringify({ ...report, ...(directory ? { report: relative(root, join(directory, 'report.json')) } : {}) }, null, 2));
}
