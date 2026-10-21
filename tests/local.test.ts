import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { AigClient } from '../src/client.ts';
import { fileServer } from '../src/node-server.ts';
import { publishFile } from '../src/adapters/file.ts';
import { AigError, canonical, MAX_RESOURCE_BYTES, parseResource } from '../src/core/resource.ts';
import type { Resource } from '../src/core/resource.ts';
import { allowContent } from '../src/core/content-mode.ts';
import { boundedJSON, readGateway } from '../src/core/http.ts';
// Local process helpers have no cloud/login/deploy commands.
// @ts-expect-error JavaScript helper is intentionally shared with the environment checks.
import { startWrangler } from '../scripts/lib/wrangler.mjs';

const execute = promisify(execFile);
const fixtures = await Promise.all(['demo-announcement-001', 'demo-note-001'].map(async id =>
  parseResource(JSON.parse(await readFile(new URL(`../examples/resources/${id}.json`, import.meta.url), 'utf8')))));
const testRoot = resolve('.local/test-runs');
await mkdir(testRoot, { recursive: true });
const folder = await mkdtemp(join(testRoot, 'functional-'));
const checks: string[] = [];
const revised = (r: Resource, revision: number, body: string): Resource => ({ ...structuredClone(r), revision,
  updated_at: `2026-10-19T12:${String(revision).padStart(2, '0')}:00Z`,
  representations: [{ media_type: 'text/plain', derivation: 'original', content_text: body }] });
const withdrawn = (r: Resource): Resource => ({ ...structuredClone(r), revision: r.revision + 1,
  updated_at: '2026-10-19T13:00:00Z', status: 'withdrawn', withdrawal_reason: '【合成测试】发布者主动撤回', representations: [] });

async function cli(file: string, args: string[]) {
  return execute(process.execPath, [resolve(file), ...args], { cwd: resolve('.'), maxBuffer: 4 * 1024 * 1024 });
}
async function publishCLI(r: Resource, args: string[]) {
  const path = join(folder, `input-${randomUUID()}.json`);
  await writeFile(path, JSON.stringify(r));
  const result = await cli('scripts/demo-publish.ts', ['--file', path, ...args]);
  return JSON.parse(result.stdout);
}
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return port;
}
async function worker(config: string, state: string) {
  const port = await freePort();
  const child = startWrangler(['dev', '--config', config, '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session', 'false']);
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (value: Buffer) => { output = (output + value).slice(-12000); });
  const closed = once(child, 'close');
  const url = `http://127.0.0.1:${port}/`;
  async function stop() {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(timer); }
  }
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Local Worker exited before readiness');
      try {
        const response = await fetch(`${url}manifest.json`, { signal: AbortSignal.timeout(1000) });
        assert.equal(response.status, 200);
        return { url, stop };
      } catch { await delay(100); }
    }
    throw new Error('Local Worker did not start');
  } catch (error) {
    await stop();
    // Never forward output that might contain a development credential.
    const clean = output.replace(/[a-f0-9]{64}/g, '[redacted]');
    throw new Error(`${error instanceof Error ? error.message : 'Worker failed'}\n${clean}`);
  }
}

test('Local AIG functional acceptance', { timeout: 120000 }, async t => {
  let failed = false;
  const check = (name: string, action: () => Promise<void>) => t.test(name, async () => {
    try { await action(); } catch (error) { failed = true; throw error; }
  });
  try {
    await check('File publishing CLI → source → HTTP → generic client; two publishers, complete text, update and withdrawal', async () => {
      const source = join(folder, 'source');
      await mkdir(source);
      const server = fileServer(source).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      const client = new AigClient(base);
      try {
        for (const original of fixtures) {
          const r = revised(original!, 1, `【合成测试】  前后空白  \r\n\n中文 🌐 A&B <tag> e\u0301\t\n${'长文本 '.repeat(8000)}\n  `);
          r.updated_at = r.published_at;
          assert.equal((await publishCLI(r, ['--source', source])).outcome, 'stored');
          assert.deepEqual(await client.get(r.id), r);
          assert.equal((await publishCLI(r, ['--source', source])).outcome, 'unchanged');
          const updated = revised(r, 2, '【合成测试】更新后的原文\n  不做摘要 🌐  ');
          await publishCLI(updated, ['--source', source]);
          assert.deepEqual(await client.get(r.id), updated);
          const currentFeed = await client.feed() as { items: { id: string; content_text: string }[] };
          assert.equal(currentFeed.items.find(item => item.id === r.id)!.content_text, updated.representations[0]!.content_text);
          await publishCLI(withdrawn(updated), ['--source', source]);
          assert.equal((await fetch(`${base}items/${r.id}.json`)).status, 410);
          assert.equal((await client.get(r.id)).representations.length, 0);
        }
        assert.equal((await client.feed() as { items: unknown[] }).items.length, 0);
        await client.manifest();
        const read = await cli('scripts/read-client.ts', ['--url', base, '--id', fixtures[0]!.id]);
        assert.equal(JSON.parse(read.stdout).status, 'withdrawn');
        checks.push('M1a: two generic publishing CLI lifecycles and client reads');
      } finally { await new Promise<void>(done => server.close(() => done())); }
    });
    await check('File source missing/corrupt/oversized/symlink inputs and unsafe paths fail explicitly', async () => {
      const directory = join(folder, 'bad-source');
      await mkdir(directory);
      const server = fileServer(directory).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      try {
        assert.equal((await fetch(`${base}/items/missing.json`)).status, 404);
        await writeFile(join(directory, 'corrupt.json'), '{bad');
        assert.equal((await fetch(`${base}/items/corrupt.json`)).status, 502);
        assert.equal((await fetch(`${base}/feed.json`)).status, 502);
        await writeFile(join(directory, 'large.json'), ' '.repeat(MAX_RESOURCE_BYTES + 1));
        assert.equal((await fetch(`${base}/items/large.json`)).status, 502);
        await symlink(resolve('package.json'), join(directory, 'link.json'));
        assert.equal((await fetch(`${base}/items/link.json`)).status, 502);
        assert.equal((await fetch(`${base}/items/%2e%2e%2fpackage.json`)).status, 400);
        assert.equal((await fetch(`${base}/feed.json?source=/private`)).status, 400);
        assert.equal((await fetch(`${base}/manifest.json`, { method: 'POST' })).status, 405);
        await rm(directory, { recursive: true });
        assert.equal((await fetch(`${base}/items/missing.json`)).status, 503);
        checks.push('M1a: missing/corrupt/oversized/offline source and path rejection');
      } finally { await new Promise<void>(done => server.close(() => done())); }
    });
    await check('Request parser rejects oversized chunked bodies, invalid UTF-8/time and default synthetic scope rejects real markers', async () => {
      const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RESOURCE_BYTES + 1)); controller.close(); } });
      const request = new Request('http://127.0.0.1/', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body, duplex: 'half' } as RequestInit);
      await assert.rejects(boundedJSON(request), (error: unknown) => error instanceof AigError && error.status === 413);
      await assert.rejects(boundedJSON(new Request('http://127.0.0.1/', { method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xff]) })), /invalid_json/);
      assert.throws(() => parseResource({ ...fixtures[0], updated_at: 'not-a-date' }), /invalid_resource/);
      assert.throws(() => allowContent(parseResource({ ...fixtures[0], synthetic: false }), 'synthetic'), /synthetic_only/);
      await assert.rejects(publishFile(join(folder, 'source'), { ...fixtures[0], revision: 8 }), /revision_conflict/);
      await assert.rejects(readGateway(new Request('http://127.0.0.1/feed.json'), {
        get: async () => null, list: async () => Array.from({ length: 101 }, () => fixtures[0]!),
      }), /feed_capacity_exceeded/);
      const large = revised(fixtures[0]!, 1, '【合成测试】' + '长正文'.repeat(20000));
      await assert.rejects(readGateway(new Request('http://127.0.0.1/feed.json'), {
        get: async () => large, list: async () => Array.from({ length: 12 }, () => large),
      }), /response_too_large/);
      checks.push('Necessary input bounds and synthetic-only local scope');
    });

    const configPath = join(folder, 'wrangler.json');
    const state = join(folder, 'state');
    const credentialPath = join(folder, 'credentials.json');
    const credentials = fixtures.map(r => ({ publisher_id: r!.publisher.id, token: randomBytes(32).toString('hex') }));
    await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600 });
    await writeFile(join(folder, '.dev.vars'), `AIG_PUBLISHERS_JSON='${JSON.stringify(credentials)}'\n`, { mode: 0o600 });
    const config = JSON.parse(await readFile('wrangler.hosting.local.jsonc', 'utf8'));
    config.main = relative(folder, resolve('src/worker.ts'));
    // Let esbuild discover the source tsconfig; nested Wrangler configs otherwise rebase it twice.
    delete config.tsconfig;
    config.d1_databases[0].migrations_dir = relative(folder, resolve('migrations'));
    delete config.$schema;
    await writeFile(configPath, JSON.stringify(config));
    // Apply the real SQL migration through Wrangler to a fresh local D1 database.
    const migration = startWrangler(['d1', 'migrations', 'apply', 'aig-local', '--config', configPath, '--local', '--persist-to', state]);
    migration.stdout.resume(); migration.stderr.resume();
    assert.equal((await once(migration, 'close'))[0], 0, 'Local D1 migration failed');

    let hosted = await worker(configPath, state);
    const syncArgs = () => ['--url', hosted.url, '--credentials', credentialPath];
    const send = (r: Resource, token = credentials[0]!.token) => fetch(`${hosted.url}publish/items/${r.id}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: canonical(r),
    });
    try {
      await check('D1 hosting saves both publishers via CLI; idempotency, conflicts, updates and withdrawal', async () => {
        const client = new AigClient(hosted.url);
        for (const r of fixtures) {
          assert.equal((await publishCLI(r!, syncArgs())).outcome, 'stored');
          assert.deepEqual(await client.get(r!.id), r);
          assert.equal((await publishCLI(r!, syncArgs())).outcome, 'unchanged');
        }
        const r = fixtures[0]!;
        const conflict = structuredClone(r);
        conflict.representations[0]!.content_text += 'conflict';
        assert.equal((await send(conflict)).status, 409);
        assert.equal((await send({ ...r, revision: 4 })).status, 409);
        const updated = revised(r, 2, '【合成托管】更新\r\n中文 🌐\t  ' + '完整正文 '.repeat(6000));
        assert.equal((await publishCLI(updated, syncArgs())).outcome, 'stored');
        assert.deepEqual(await client.get(r.id), updated);
        const retry = await publishCLI(r, syncArgs());
        assert.equal(retry.outcome, 'unchanged');
        assert.equal(retry.current_revision, 2);
        assert.deepEqual(await client.get(r.id), updated);
        const gone = withdrawn(updated);
        assert.equal((await publishCLI(gone, syncArgs())).outcome, 'stored');
        assert.equal((await fetch(`${hosted.url}items/${r.id}.json`)).status, 410);
        assert.equal((await client.get(r.id)).representations.length, 0);
        const feed = await client.feed() as { items: { id: string }[] };
        assert.deepEqual(feed.items.map(item => item.id), [fixtures[1]!.id]);
        assert.equal((await publishCLI(gone, syncArgs())).outcome, 'unchanged');
        await publishCLI(r, syncArgs());
        assert.equal((await client.get(r.id)).status, 'withdrawn');
        checks.push('D1: two CLI publishers, exact text, retries/conflicts, update, withdrawal and stale retry');
      });
      await check('Concurrent conflicting writes accept one revision without overwriting', async () => {
        const a = { ...structuredClone(fixtures[0]!), id: 'concurrent-item' };
        const b = structuredClone(a); b.representations[0]!.content_text += 'other';
        const results = await Promise.all([send(a), send(b)]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        const actual = await new AigClient(hosted.url).get(a.id);
        assert.deepEqual(actual, results[0]!.status === 200 ? a : b);
        const second = revised(actual, 2, '【合成并发】下一版本');
        const other = revised(actual, 2, '【合成并发】冲突版本');
        const updates = await Promise.all([send(second), send(other)]);
        assert.deepEqual(updates.map(r => r.status).sort(), [200, 409]);
        checks.push('D1: atomic concurrent publish/update conflicts');
      });
      await check('Missing/wrong credentials, cross-publisher writes/withdrawals, malformed/oversized input and private routes', async () => {
        const r = { ...fixtures[0]!, id: 'unauthorized-item' };
        const url = `${hosted.url}publish/items/${r.id}.json`;
        assert.equal((await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: canonical(r) })).status, 401);
        assert.equal((await send(r, '0'.repeat(64))).status, 401);
        assert.equal((await send(r, credentials[1]!.token)).status, 403);
        const spoofed = { ...withdrawn(fixtures[0]!), publisher: fixtures[1]!.publisher };
        assert.equal((await send(spoofed, credentials[1]!.token)).status, 403);
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials[0]!.token}` };
        assert.equal((await fetch(url, { method: 'PUT', headers, body: '{' })).status, 400);
        assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ ...r, unexpected: true }) })).status, 422);
        assert.equal((await fetch(url, { method: 'PUT', headers, body: ' '.repeat(MAX_RESOURCE_BYTES + 1) })).status, 413);
        assert.equal((await fetch(url, { method: 'PUT', headers: { Authorization: headers.Authorization }, body: '{}' })).status, 415);
        for (const path of ['.dev.vars', 'admin', 'db', 'revisions', 'publish/config', 'items/unauthorized-item.json']) {
          const response = await fetch(`${hosted.url}${path}`);
          assert.equal(response.status, 404);
          const body = await response.text();
          assert(!body.includes(credentials[0]!.token));
        }
        checks.push('Hosting: credential scope, private routes, format/size rejection');
      });
      await check('Failed authentication reaches 429 without blocking the valid publisher key', async () => {
        const statuses = [];
        for (let i = 0; i < 12; i++) statuses.push((await send(fixtures[0]!, '0'.repeat(64))).status);
        assert(statuses.includes(429));
        assert.equal((await send(fixtures[1]!, credentials[1]!.token)).status, 200);
        checks.push('Hosting: failed-authentication rate limit with valid-key access');
      });
    } finally { await hosted.stop(); }

    hosted = await worker(configPath, state);
    try {
      await check('D1 restart preserves published and withdrawn state with the publishing process stopped', async () => {
        const client = new AigClient(hosted.url);
        assert.equal((await client.get(fixtures[0]!.id)).status, 'withdrawn');
        assert.deepEqual(await client.get(fixtures[1]!.id), fixtures[1]);
        assert.equal((await client.get('concurrent-item')).revision, 2);
        checks.push('D1: restart persistence and publisher-process independence on localhost');
      });
      await check('General request limiting returns 429 and Retry-After', async () => {
        let limited = false;
        for (let i = 0; i < 130; i++) {
          const response = await fetch(`${hosted.url}manifest.json`);
          if (response.status === 429) { assert.equal(response.headers.get('retry-after'), '60'); limited = true; break; }
        }
        assert(limited);
        checks.push('Hosting: general request rate limit');
      });
    } finally { await hosted.stop(); }
    await check('Storage failure returns 503 and never acknowledges publication', async () => {
      const missing = await worker(configPath, join(folder, 'uninitialized-state'));
      try {
        const response = await fetch(`${missing.url}publish/items/${fixtures[0]!.id}.json`, { method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials[0]!.token}` },
          body: canonical(fixtures[0]) });
        assert.equal(response.status, 503);
        assert.equal((await fetch(`${missing.url}feed.json`)).status, 503);
        checks.push('Hosting: uninitialized storage fails explicitly');
      } finally { await missing.stop(); }
    });
    if (failed) return;
    await writeFile(resolve('.local/functional-check.json'), JSON.stringify({ checked_at: new Date().toISOString(), ok: true,
      scope: 'local synthetic functionality only; no cloud/public/DOS acceptance', checks }, null, 2) + '\n');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
