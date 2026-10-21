import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as tlsServer, get as httpsGet } from 'node:https';
import { createServer as portServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { MAX_RESPONSE_BYTES } from '../src/core/resource.ts';
import { configuration, cloudTarget } from '../scripts/lib/preflight.ts';
// @ts-expect-error Shared local-only Wrangler wrapper.
import { startWrangler } from '../scripts/lib/wrangler.mjs';

const execute = promisify(execFile);
const fixture = 'examples/resources/demo-announcement-001.json';
async function cli(script: string, args: string[], ca?: string) {
  return execute(process.execPath, [resolve(script), ...args], { cwd: resolve('.'), maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}) } });
}
async function freePort() {
  const server = portServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(done => server.close(() => done()));
  return port;
}
async function probe(url: string, ca: Buffer) {
  return new Promise<number>((done, reject) => {
    const req = httpsGet(url, { ca }, res => { res.resume(); done(res.statusCode!); });
    req.setTimeout(1000, () => req.destroy(new Error('TLS probe timeout')));
    req.on('error', reject);
  });
}

test('Prelaunch preparation and HTTPS rehearsal', { timeout: 120000 }, async t => {
  await mkdir('.local/test-runs', { recursive: true });
  const folder = await mkdtemp(resolve('.local/test-runs/preflight-'));
  const directory = join(folder, 'prepared');
  const checks: string[] = [];
  let failed = false;
  const check = (name: string, action: () => Promise<void>) => t.test(name, async () => {
    try { await action(); } catch (error) { failed = true; throw error; }
  });
  try {
    await check('Offline preparation isolates keys, closed/public configs, plan and deployment bundle', async () => {
      await cli('scripts/prepare-validation.ts', ['--directory', directory]);
      const credentials = JSON.parse(await readFile(join(directory, 'publisher-credentials.json'), 'utf8'));
      assert.equal(credentials.length, 2); assert.notEqual(credentials[0].token, credentials[1].token);
      for (const path of ['publisher-credentials.json', 'secrets.json']) assert.equal((await stat(join(directory, path))).mode & 0o777, 0o600);
      const closed = JSON.parse(await readFile(join(directory, 'wrangler.closed.json'), 'utf8'));
      const open = JSON.parse(await readFile(join(directory, 'wrangler.public.json'), 'utf8'));
      assert.deepEqual(closed.routes, []); assert.equal(closed.workers_dev, false); assert.equal(closed.preview_urls, false);
      assert.equal(closed.d1_databases[0].remote, false); assert.equal(closed.limits.cpu_ms, 50);
      assert.deepEqual(open.routes, [{ pattern: 'aig-verify.example.invalid', custom_domain: true }]);
      const plannedTarget = JSON.parse(await readFile(join(directory, 'target.json'), 'utf8'));
      assert.throws(() => cloudTarget({ ...plannedTarget, origin: 'http://bad.example.invalid/' }));
      const plan = await cli('scripts/cloud-validation.ts', ['plan', '--directory', directory]);
      const planned = JSON.parse(plan.stdout);
      assert.equal(planned.actual_target_filled, false);
      assert.equal(planned.shutdown_REQUIRED.domain, new URL(plannedTarget.origin).hostname);
      assert.equal(planned.shutdown_REQUIRED.closed_config_removes_existing_custom_domains, false);
      assert(planned.shutdown_REQUIRED.steps_NOT_EXECUTED.some((step: string) => step.includes('Remove this exact custom-domain binding')));
      assert(!plan.stdout.includes(credentials[0].token));
      await assert.rejects(cli('scripts/cloud-validation.ts', ['deploy', '--directory', directory]));
      const bundle = await cli('scripts/cloud-validation.ts', ['bundle', '--directory', directory]);
      assert(!bundle.stdout.includes(credentials[0].token));
      const snapshot = JSON.parse(await readFile(join(directory, 'source-snapshot.json'), 'utf8'));
      assert(snapshot.files.some((file: { path: string }) => file.path === 'package-lock.json'));
      assert(snapshot.files.every((file: { path: string }) => !file.path.startsWith('.local/')));
      for (const file of await readdir(join(directory, 'bundle'))) {
        const body = await readFile(join(directory, 'bundle', file), 'utf8');
        assert(!body.includes(credentials[0].token));
      }
      await cli('scripts/prepare-validation.ts', ['--directory', directory]);
      assert.deepEqual(JSON.parse(await readFile(join(directory, 'publisher-credentials.json'), 'utf8')), credentials);
      checks.push('Offline config/plan/bundle, separate 0600 keys, preserved keys, no token in bundle');
    });
    const targetPath = join(folder, 'target.json');
    await writeFile(targetPath, JSON.stringify({ origin: 'https://allowed.example.invalid/' }));
    await check('CLI defaults stay local; explicit target rejects mismatch, HTTP, credentials, paths and extra query', async () => {
      for (const url of ['https://blocked.example.invalid/', 'http://allowed.example.invalid/',
        'https://allowed.example.invalid/path', 'https://allowed.example.invalid/?x=1', 'https://a:b@allowed.example.invalid/']) {
        await assert.rejects(cli('scripts/read-client.ts', ['--url', url, '--target', targetPath]));
        await assert.rejects(cli('scripts/demo-publish.ts', ['--file', fixture, '--url', url, '--target', targetPath]));
      }
      await assert.rejects(cli('scripts/read-client.ts', ['--url', 'https://allowed.example.invalid/']));
      await assert.rejects(cli('scripts/demo-publish.ts', ['--file', fixture, '--target', targetPath]));
      await writeFile(targetPath, JSON.stringify({ origin: 'http://127.0.0.1/' }));
      await assert.rejects(cli('scripts/read-client.ts', ['--target', targetPath]));
      checks.push('Exact HTTPS origin selection; local defaults and explicit credential requirement');
    });

    const keyPath = join(folder, 'key.pem'), certPath = join(folder, 'cert.pem');
    const opensslConfig = join(folder, 'openssl.cnf');
    await writeFile(opensslConfig, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=localhost\n[v3]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
    await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', opensslConfig,
      '-keyout', keyPath, '-out', certPath]);
    await chmod(keyPath, 0o600);
    const ca = await readFile(certPath);
    const credentialsPath = join(directory, 'publisher-credentials.json');
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    await writeFile(join(directory, '.dev.vars'), `AIG_PUBLISHERS_JSON='${JSON.stringify(credentials)}'\n`, { mode: 0o600 });
    const configPath = join(directory, 'wrangler.closed.json');
    const state = join(folder, 'state');
    const target = cloudTarget(JSON.parse(await readFile(join(directory, 'target.json'), 'utf8')));
    await writeFile(configPath, JSON.stringify(configuration(target, directory)));
    const migration = startWrangler(['d1', 'migrations', 'apply', target.database_name, '--config', configPath, '--local', '--persist-to', state]);
    migration.stdout.resume(); migration.stderr.resume();
    assert.equal((await once(migration, 'close'))[0], 0, 'Local validation D1 migration failed');
    const port = await freePort();
    const url = `https://127.0.0.1:${port}/`;
    const child = startWrangler(['dev', '--config', configPath, '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--inspector-port', '0', '--persist-to', state, '--local-protocol', 'https', '--https-key-path', keyPath,
      '--https-cert-path', certPath, '--show-interactive-dev-session', 'false']);
    child.stdout.resume(); child.stderr.resume();
    const closed = once(child, 'close');
    try {
      let ready = false;
      for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) break;
        try { if (await probe(`${url}manifest.json`, ca) === 200) { ready = true; break; } } catch { /* Wait for local TLS only. */ }
        await delay(100);
      }
      assert(ready, 'Local TLS Worker did not start');
      await writeFile(targetPath, JSON.stringify({ origin: url }));
      await check('Real CLI and three-phase acceptance run over trusted local TLS to local D1', async () => {
        // A self-signed certificate fails unless this test explicitly supplies its CA.
        await assert.rejects(cli('scripts/read-client.ts', ['--target', targetPath]));
        const runPath = join(folder, 'run', 'run.json');
        const base = ['--target', targetPath, '--run', runPath];
        const published = await cli('scripts/validate-gateway.ts', [...base, '--phase', 'publish', '--credentials', credentialsPath], certPath);
        assert.equal(JSON.parse(published.stdout).ok, true);
        const beforeRead = await readFile(runPath, 'utf8');
        const read = await cli('scripts/validate-gateway.ts', [...base, '--phase', 'read'], certPath);
        assert.equal(JSON.parse(read.stdout).scope, 'local HTTPS rehearsal only');
        assert.equal(await readFile(runPath, 'utf8'), beforeRead, 'Read-only check changed the publishing state');
        assert(JSON.parse(read.stdout).manual_NOT_RUN.some((name: string) => name.includes('A6')));
        const stateBefore = JSON.parse(beforeRead);
        const itemPath = join(folder, 'repeat.json');
        await writeFile(itemPath, JSON.stringify(stateBefore.versions[0]));
        const repeat = await cli('scripts/demo-publish.ts', ['--file', itemPath, '--target', targetPath, '--credentials', credentialsPath], certPath);
        assert.equal(JSON.parse(repeat.stdout).current_revision, 2);
        const single = await cli('scripts/read-client.ts', ['--target', targetPath, '--id', stateBefore.expected[0].id], certPath);
        assert.deepEqual(JSON.parse(single.stdout), stateBefore.expected[0]);
        const withdrawn = await cli('scripts/validate-gateway.ts', [...base, '--phase', 'withdraw', '--credentials', credentialsPath], certPath);
        assert.equal(JSON.parse(withdrawn.stdout).ok, true);
        await cli('scripts/validate-gateway.ts', [...base, '--phase', 'read'], certPath);
        assert.equal(JSON.parse(await readFile(runPath, 'utf8')).state, 'withdrawn');
        for (const output of [published, read, repeat, single, withdrawn]) {
          assert(!output.stdout.includes(credentials[0].token)); assert(!output.stderr.includes(credentials[0].token));
        }
        checks.push('Trusted local TLS: publish/read/withdraw phases, two publishers, exact text/version, status/Feed, read-only replay');
      });
    } finally {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await closed; } finally { clearTimeout(timer); }
    }
    await check('Read/write redirects never forward keys; invalid or oversized responses fail and receipts discard extra fields', async () => {
      let sinkRequests = 0, mode = 'redirect';
      const tls = { key: await readFile(keyPath), cert: ca };
      const sink = tlsServer(tls, (_req, res) => { sinkRequests++; res.end('{}'); }).listen(0, '127.0.0.1');
      await once(sink, 'listening');
      const sinkURL = `https://127.0.0.1:${(sink.address() as { port: number }).port}/`;
      const server = tlsServer(tls, (req, res) => {
        req.resume();
        if (mode === 'redirect') { res.writeHead(307, { Location: sinkURL }); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (mode === 'oversized') { res.end(JSON.stringify({ data: 'a'.repeat(MAX_RESPONSE_BYTES) })); return; }
        res.end(JSON.stringify({ id: mode === 'invalid-receipt' ? 'wrong-id' : 'demo-announcement-001', revision: 1,
          outcome: 'stored', current_revision: 1, current_status: 'published', unwanted: credentials[0].token }));
      }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const origin = `https://127.0.0.1:${(server.address() as { port: number }).port}/`;
      await writeFile(targetPath, JSON.stringify({ origin }));
      const args = ['--file', fixture, '--target', targetPath, '--credentials', credentialsPath];
      try {
        await assert.rejects(cli('scripts/demo-publish.ts', args, certPath));
        await assert.rejects(cli('scripts/read-client.ts', ['--target', targetPath], certPath));
        assert.equal(sinkRequests, 0);
        mode = 'invalid-receipt'; await assert.rejects(cli('scripts/demo-publish.ts', args, certPath));
        mode = 'valid-receipt';
        const result = await cli('scripts/demo-publish.ts', args, certPath);
        assert(!result.stdout.includes(credentials[0].token)); assert.equal(JSON.parse(result.stdout).outcome, 'stored');
        mode = 'oversized'; await assert.rejects(cli('scripts/read-client.ts', ['--target', targetPath], certPath));
        checks.push('TLS verification kept enabled; no redirect/key forwarding; bounded JSON and validated receipts');
      } finally {
        await Promise.all([server, sink].map(server => new Promise<void>(done => server.close(() => done()))));
      }
    });
    if (!failed) await writeFile('.local/prelaunch-check.json', JSON.stringify({ checked_at: new Date().toISOString(), ok: true,
      scope: 'offline preparation and local HTTPS only; cloud/public/DOS NOT_RUN', checks }, null, 2) + '\n');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
