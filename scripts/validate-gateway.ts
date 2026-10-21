import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AigClient, AigHttpError } from '../src/client.ts';
import { canonical, parseResource, tombstone } from '../src/core/resource.ts';
import type { Resource } from '../src/core/resource.ts';
import { loopback } from '../src/core/base-url.ts';
import { localDirectory, root, writeJSON } from './lib/preflight.ts';
import { readCredentials, targetURL } from './lib/target.ts';
import { checkReader } from '../src/reader-check.ts';

interface Run {
  schema_version: 'aig-validation-run/1'; origin: string; run_id: string;
  state: 'prepared' | 'published' | 'withdrawn'; versions: Resource[]; expected: Resource[];
}
const same = (left: unknown, right: unknown, label: string) => {
  if (canonical(left) !== canonical(right)) throw new Error(label);
};
async function expectHTTP(status: number, action: () => Promise<unknown>) {
  try { await action(); } catch (error) {
    if (error instanceof AigHttpError && error.status === status) return;
    throw new Error(`Expected HTTP ${status}`);
  }
  throw new Error(`Expected HTTP ${status}`);
}
async function verify(client: AigClient, run: Run) {
  await checkReader(client, { schema_version: 'aig-reader-expectation/1', origin: run.origin, gateway_synthetic: true, resources: run.expected });
}

let reportPath: string | undefined;
const checks: string[] = [];
let report: Record<string, unknown> = {};
try {
  const { values } = parseArgs({ options: {
    target: { type: 'string' }, credentials: { type: 'string' }, phase: { type: 'string', default: 'read' }, run: { type: 'string' },
  } });
  if (!values.target || !['publish', 'read', 'withdraw'].includes(values.phase!)) throw new Error('Choose --target and --phase publish/read/withdraw');
  if (values.phase === 'read' && values.credentials) throw new Error('Read verification does not take credentials');
  if (values.phase !== 'publish' && !values.run) throw new Error('Read/withdraw needs the selected --run file');
  if (values.phase !== 'read' && !values.credentials) throw new Error('Writing needs explicit --credentials');
  const url = await targetURL(undefined, values.target);
  const runPath = values.run ? join(localDirectory(dirname(resolve(root, values.run))), basename(values.run)) :
    join(localDirectory(), 'runs', randomUUID(), 'run.json');
  reportPath = join(runPath + '.reports', `${values.phase}-${randomUUID()}.json`);
  report = { phase: values.phase, origin: url.origin, run: relative(root, runPath),
    scope: loopback(url.hostname) ? 'local HTTPS rehearsal only' : 'selected remote endpoint checks only; client location not established',
    manual_NOT_RUN: ['A1 account/bindings/private backend', 'A6 independent overseas client/offline 15-minute check',
      'A8 cloud redeployment', 'A10 rate-limit window', 'A11 shutdown/keys/fees'],
    checks };
  const client = new AigClient(url.href);
  let run: Run;
  if (values.phase === 'publish') {
    try { await readFile(runPath); throw new Error('Run already exists; select a new run path'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const run_id = randomUUID();
    const versions = await Promise.all(['demo-announcement-001', 'demo-note-001'].map(async (id, index) => {
      const fixture = parseResource(JSON.parse(await readFile(join(root, 'examples/resources', `${id}.json`), 'utf8')));
      fixture.id = `validation-${run_id}-${index}`;
      fixture.source.record_id = fixture.id;
      fixture.published_at = fixture.updated_at = new Date().toISOString();
      if (index === 0) fixture.representations[0]!.content_text = '【合成上线验证】  首尾空白\r\n\n中文 🌐 A&B <tag> e\u0301\t\n' + '完整长文本 '.repeat(2000) + '\n  ';
      return parseResource(fixture);
    }));
    run = { schema_version: 'aig-validation-run/1', origin: url.origin, run_id, state: 'prepared', versions, expected: [] };
    await writeJSON(runPath, run);
  } else {
    try { run = JSON.parse(await readFile(runPath, 'utf8')); }
    catch { throw new Error('Cannot read the selected public synthetic run'); }
    if (run.schema_version !== 'aig-validation-run/1' || run.origin !== url.origin ||
        !['published', 'withdrawn'].includes(run.state) || !Array.isArray(run.versions) || !Array.isArray(run.expected) ||
        run.expected.length !== 2 || run.versions.length < 3) throw new Error('Run origin, phase or expected resources mismatch');
    run.versions = run.versions.map(parseResource); run.expected = run.expected.map(parseResource);
  }
  if (values.phase === 'read') {
    await verify(client, run);
    checks.push('Read-only: manifest origin, full resources, source/version, Feed and withdrawal status, no-store');
  } else {
    const credentials = await readCredentials(values.credentials!);
    const token = (r: Resource) => {
      const key = credentials.find(c => c.publisher_id === r.publisher.id);
      if (!key) throw new Error('Missing validation publisher scope');
      return key.token;
    };
    if (values.phase === 'publish') {
      for (const original of run.versions) {
        await expectHTTP(404, () => client.get(original.id));
        const receipt = await client.publish(original, token(original));
        same(receipt.outcome, 'stored', 'New validation ID was not stored');
        run.expected.push(original); await writeJSON(runPath, run);
        same((await client.publish(original, token(original))).outcome, 'unchanged', 'Retry is not idempotent');
      }
      await verify(client, run);
      checks.push('A2/A3: two publishers, complete multilingual long text and Feed; idempotent retries');
      const first = run.versions[0]!;
      const conflict = structuredClone(first); conflict.representations[0]!.content_text += '【合成冲突】';
      await expectHTTP(409, () => client.publish(conflict, token(first)));
      await expectHTTP(409, () => client.publish({ ...first, revision: 4 }, token(first)));
      const updated = structuredClone(first);
      updated.revision = 2; updated.updated_at = new Date().toISOString();
      updated.representations[0]!.content_text = '【合成更新】\r\n  完整正文，保留 tab\t和 emoji 🌐 e\u0301\n  ';
      same((await client.publish(updated, token(updated))).outcome, 'stored', 'Update was not stored');
      run.versions.push(updated); run.expected[0] = updated;
      run.state = 'published'; await writeJSON(runPath, run);
      await client.publish(first, token(first));
      await verify(client, run);
      checks.push('A4/A5: conflicts rejected, revision 2 visible, old retry does not roll back');
      await expectHTTP(401, () => client.publish(first, '0'.repeat(64)));
      await expectHTTP(403, () => client.publish(updated, token(run.expected[1]!)));
      await verify(client, run);
      checks.push('A9 partial: wrong key and cross-publisher scope rejected without changing content');
    } else {
      if (run.state !== 'published') throw new Error('Withdraw requires the published phase');
      await verify(client, run);
      const previous = run.expected[0]!;
      const gone: Resource = { ...structuredClone(previous), revision: previous.revision + 1, status: 'withdrawn',
        updated_at: new Date().toISOString(), withdrawal_reason: '【合成上线验证】主动撤回', representations: [] };
      same((await client.publish(gone, token(gone))).outcome, 'stored', 'Withdrawal was not stored');
      run.versions.push(gone); run.expected[0] = gone; run.state = 'withdrawn'; await writeJSON(runPath, run);
      for (const old of run.versions.filter(r => r.id === gone.id && r.revision < gone.revision)) {
        same((await client.publish(old, token(old))).outcome, 'unchanged', 'Old accepted version not recognized');
      }
      await verify(client, run);
      checks.push('A7/A8 partial: 410 tombstone, no withdrawn Feed item, old accepted requests do not restore content');
    }
  }
  report.expected = run.expected.map(r => ({ id: r.id, revision: r.revision, status: r.status,
    resource_sha256: createHash('sha256').update(canonical(r.status === 'withdrawn' ? tombstone(r) : r)).digest('hex') }));
  report.ok = true;
  await writeJSON(reportPath, { ...report, checked_at: new Date().toISOString() });
  console.log(JSON.stringify({ ...report, report: relative(root, reportPath) }, null, 2));
} catch {
  if (reportPath) await writeJSON(reportPath, { ...report, ok: false, checked_at: new Date().toISOString(),
    error: 'Selected checks incomplete; inspect last accepted versions before retrying.' });
  console.error('Gateway validation failed; no overall public acceptance is claimed. Check target, TLS, credentials and the selected run.');
  process.exitCode = 1;
}
