import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { configuration } from '../scripts/lib/preflight.ts';

const execute = promisify(execFile);
const cli = (file: string, args: string[]) => execute(process.execPath, [resolve(file), ...args], { cwd: resolve('.'), maxBuffer: 4 * 1024 * 1024 });

test('Generic public publisher profile stays offline, pinned and separate from test keys', { timeout: 60000 }, async t => {
  await mkdir('.local/test-runs', { recursive: true });
  const folder = await mkdtemp(resolve('.local/test-runs/formal-profile-'));
  const directory = join(folder, 'formal');
  const target = JSON.parse(await readFile('dev/validation-target.example.json', 'utf8'));
  target.origin = 'https://publisher.example.invalid/';
  const targetPath = join(folder, 'input-target.json');
  await writeFile(targetPath, JSON.stringify(target));
  const publisher = 'urn:publisher:independent-formal-profile';
  const args = ['--publisher-id', publisher, '--directory', directory, '--target', targetPath, '--content-mode', 'public'];
  try {
    const first = await cli('scripts/prepare-publisher.ts', args);
    const credentials = await readFile(join(directory, 'publisher-credentials.json'), 'utf8');
    const key = JSON.parse(credentials)[0].token;
    await t.test('Single arbitrary scope and explicit public mode produce closed-by-default local artifacts', async () => {
      const closed = JSON.parse(await readFile(join(directory, 'wrangler.closed.json'), 'utf8'));
      const candidate = JSON.parse(await readFile(join(directory, 'wrangler.public.json'), 'utf8'));
      const profile = JSON.parse(await readFile(join(directory, 'deployment-profile.json'), 'utf8'));
      assert.equal(closed.vars.AIG_CONTENT_MODE, 'public');
      assert.equal(candidate.vars.AIG_CONTENT_MODE, 'public');
      assert.deepEqual(closed.routes, []);
      assert.equal(closed.workers_dev, false); assert.equal(closed.preview_urls, false);
      assert.deepEqual(candidate.routes, [{ pattern: 'publisher.example.invalid', custom_domain: true }]);
      assert.equal(profile.enabled, false); assert.equal(profile.publisher_id, publisher);
      assert.equal(profile.target.origin, 'https://publisher.example.invalid');
      assert.deepEqual(JSON.parse(credentials).map((c: { publisher_id: string }) => c.publisher_id), [publisher]);
      assert.equal(configuration(target, directory).vars.AIG_CONTENT_MODE, 'synthetic');
      for (const file of ['publisher-credentials.json', 'secrets.json', '.dev.vars', 'deployment-profile.json', 'target.json', 'wrangler.closed.json', 'wrangler.public.json']) {
        assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
      }
      assert(!first.stdout.includes(key) && !first.stderr.includes(key));
    });
    await t.test('Repeat preserves key; mode, scope and target changes are rejected without replacing profile', async () => {
      await cli('scripts/prepare-publisher.ts', args);
      assert.equal(await readFile(join(directory, 'publisher-credentials.json'), 'utf8'), credentials);
      for (const changed of [args.map(v => v === publisher ? 'urn:publisher:other' : v), args.map(v => v === 'public' ? 'synthetic' : v)]) {
        await assert.rejects(cli('scripts/prepare-publisher.ts', changed));
      }
      const foreignPath = join(folder, 'other-target.json');
      await writeFile(foreignPath, JSON.stringify({ ...target, origin: 'https://other.example.invalid/' }));
      await assert.rejects(cli('scripts/prepare-publisher.ts', args.map(v => v === targetPath ? foreignPath : v)));
      assert.equal(await readFile(join(directory, 'publisher-credentials.json'), 'utf8'), credentials);
    });
    await t.test('Formal profile cannot reuse previously prepared local publisher keys', async () => {
      const local = join(folder, 'local-only');
      await cli('scripts/prepare-publisher.ts', ['--publisher-id', publisher, '--directory', local]);
      await assert.rejects(cli('scripts/prepare-publisher.ts', args.map(v => v === directory ? local : v)));
    });
    await t.test('Plan and dry-run bundle support this generic publisher without demo scopes or cloud calls', async () => {
      const planned = await cli('scripts/cloud-validation.ts', ['plan', '--directory', directory]);
      const plan = JSON.parse(planned.stdout);
      assert.equal(plan.publisher_id, publisher); assert.equal(plan.content_mode, 'public');
      assert.equal(plan.origin, 'https://publisher.example.invalid');
      assert.equal(plan.actual_target_filled, false);
      assert.equal(plan.shutdown_REQUIRED.closed_config_removes_existing_custom_domains, false);
      assert(!planned.stdout.includes(key) && !planned.stderr.includes(key));
      const bundled = await cli('scripts/cloud-validation.ts', ['bundle', '--directory', directory]);
      assert(!bundled.stdout.includes(key) && !bundled.stderr.includes(key));
      const snapshot = JSON.parse(await readFile(join(directory, 'source-snapshot.json'), 'utf8'));
      assert.equal(snapshot.source_sha256.length, 64); assert(snapshot.bundle.length > 0);
      for (const file of await readdir(join(directory, 'bundle'))) {
        if ((await stat(join(directory, 'bundle', file))).isFile()) assert(!(await readFile(join(directory, 'bundle', file), 'utf8')).includes(key));
      }
      assert.equal(JSON.parse(await readFile(join(directory, 'wrangler.closed.json'), 'utf8')).routes.length, 0);
    });
  } finally { await rm(folder, { recursive: true, force: true }); }
});
