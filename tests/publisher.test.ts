import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { once } from 'node:events';
import { AigClient, AigHttpError } from '../src/client.ts';
import { fileServer } from '../src/node-server.ts';
import { contentMode } from '../src/core/content-mode.ts';
import { publisherCredentials } from '../src/core/publishers.ts';
import { parseResource } from '../src/core/resource.ts';
import { readGateway } from '../src/core/http.ts';
import { checkReader, readerExpectation } from '../src/reader-check.ts';
import { startLocalHosting } from '../scripts/lib/local-host.ts';
import { writeJSON } from '../scripts/lib/preflight.ts';

const execute = promisify(execFile);
const cli = (file: string, args: string[]) => execute(process.execPath, [resolve(file), ...args], { cwd: resolve('.'), maxBuffer: 4 * 1024 * 1024 });
const status = (code: number) => (error: unknown) => error instanceof AigHttpError && error.status === code;

test('Generic publisher support and independent reader contract', { timeout: 120000 }, async t => {
  await mkdir('.local/test-runs', { recursive: true });
  const folder = await mkdtemp(resolve('.local/test-runs/publisher-'));
  const directory = join(folder, 'publisher');
  const publisher_id = 'urn:publisher:independent-newsroom';
  let host: Awaited<ReturnType<typeof startLocalHosting>> | undefined;
  try {
    await t.test('Arbitrary publisher onboarding is scoped, repeatable and does not print keys', async () => {
      const args = ['--publisher-id', publisher_id, '--directory', directory];
      const first = await cli('scripts/prepare-publisher.ts', args);
      const credentials = await readFile(join(directory, 'publisher-credentials.json'), 'utf8');
      const second = await cli('scripts/prepare-publisher.ts', args);
      assert.equal(await readFile(join(directory, 'publisher-credentials.json'), 'utf8'), credentials);
      const key = JSON.parse(credentials)[0].token;
      for (const output of [first, second]) assert(!output.stdout.includes(key) && !output.stderr.includes(key));
      for (const file of ['publisher-credentials.json', 'secrets.json', '.dev.vars']) assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
      await assert.rejects(cli('scripts/prepare-publisher.ts', ['--publisher-id', 'urn:publisher:another', '--directory', directory]));
      assert.equal(await readFile(join(directory, 'publisher-credentials.json'), 'utf8'), credentials);
      const credential = JSON.parse(credentials)[0];
      assert.throws(() => publisherCredentials([credential, credential]), /publisher_configuration_unavailable/);
      assert.throws(() => publisherCredentials([credential, { ...credential, publisher_id: 'urn:publisher:second' }]), /publisher_configuration_unavailable/);
      assert.throws(() => publisherCredentials([{ publisher_id: 'relative-id', token: key }]), /publisher_configuration_unavailable/);
      // A fresh checkout must prepare keys/command plans without generated runtime validators or dependencies.
      const fresh = join(folder, 'fresh');
      for (const path of ['scripts/prepare-publisher.ts', 'scripts/prepare-validation.ts', 'scripts/cloud-validation.ts',
        'scripts/lib/publisher.ts', 'scripts/lib/preflight.ts', 'scripts/lib/target.ts', 'scripts/lib/wrangler.mjs',
        'src/core/publishers.ts', 'src/core/base-url.ts', 'dev/validation-target.example.json']) {
        const destination = join(fresh, path); await mkdir(dirname(destination), { recursive: true }); await cp(path, destination);
      }
      await cli(join(fresh, 'scripts/prepare-publisher.ts'), ['--publisher-id', publisher_id, '--directory', '.local/publisher']);
      await cli(join(fresh, 'scripts/prepare-validation.ts'), []);
      assert.equal(JSON.parse((await cli(join(fresh, 'scripts/cloud-validation.ts'), ['plan'])).stdout).actual_target_filled, false);
      await assert.rejects(access(join(fresh, '.local/validators.mjs')));
      await assert.rejects(access(join(fresh, 'node_modules')));
    });
    const template = JSON.parse(await readFile('examples/resources/demo-announcement-001.json', 'utf8'));
    // Entirely fabricated text: false only exercises the production marker locally, never actual private content.
    const resource = parseResource({ ...template, id: 'fabricated-real-marker', publisher: { id: publisher_id, name: '【合成测试】独立发布者' },
      synthetic: false, source: { system: 'test-tool', record_id: 'fabricated-real-marker', public_url: 'https://publisher.example.invalid/item' },
      representations: [{ media_type: 'text/plain', derivation: 'original', content_text: '【合成测试，非真实稿件】  原文\r\n中文 🌐 e\u0301\t\n  ' }] });
    const credentialPath = join(directory, 'publisher-credentials.json');
    const token = JSON.parse(await readFile(credentialPath, 'utf8'))[0].token;
    const inputPath = join(folder, 'fabricated.json'); await writeJSON(inputPath, resource);
    await t.test('Default synthetic deployment rejects real markers before storage and hides a mismatched source', async () => {
      assert.equal(contentMode(), 'synthetic'); assert.throws(() => contentMode('production'), /invalid_content_mode/);
      await assert.rejects(cli('scripts/demo-publish.ts', ['--file', inputPath, '--source', join(folder, 'file-source')]), /synthetic_only/);
      const source = { get: async () => resource, list: async () => [resource] };
      await assert.rejects(readGateway(new Request('http://127.0.0.1/items/fabricated-real-marker.json'), source), /source_content_mode_mismatch/);
      await assert.rejects(readGateway(new Request('http://127.0.0.1/feed.json'), source), /source_content_mode_mismatch/);
      host = await startLocalHosting(directory);
      const client = new AigClient(host.url);
      await assert.rejects(client.publish(resource, token), status(422));
      await assert.rejects(client.get(resource.id), status(404));
      await host.stop(); host = undefined;
    });
    await t.test('Public file-source mode preserves fabricated real-marker resources without requiring hosting', async () => {
      const source = join(folder, 'public-file-source');
      await cli('scripts/demo-publish.ts', ['--file', inputPath, '--source', source, '--content-mode', 'public']);
      const server = fileServer(source, 'public').listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const client = new AigClient(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
        assert.deepEqual(await client.get(resource.id), resource);
        assert.equal((await client.manifest() as { synthetic: boolean }).synthetic, false);
      } finally { await new Promise<void>(done => server.close(() => done())); }
    });
    host = await startLocalHosting(directory, 'public');
    let client = new AigClient(host.url);
    const demo = parseResource({ ...structuredClone(resource), id: 'fabricated-synthetic-marker', synthetic: true,
      source: { ...resource.source, record_id: 'fabricated-synthetic-marker' } });
    await t.test('Explicit public mode stores fabricated real markers and labels mixed synthetic resources correctly', async () => {
      const args = ['--file', inputPath, '--url', host!.url, '--credentials', credentialPath];
      await assert.rejects(cli('scripts/demo-publish.ts', args), /synthetic_only/);
      assert.equal(JSON.parse((await cli('scripts/demo-publish.ts', [...args, '--content-mode', 'public'])).stdout).outcome, 'stored');
      assert.deepEqual(await client.get(resource.id), resource);
      await client.publish(demo, token);
      const manifest = await client.manifest() as { synthetic: boolean }; assert.equal(manifest.synthetic, false);
      const feed = await client.feed() as { _aig: { synthetic: boolean }; items: { id: string; _aig: { synthetic: boolean } }[] };
      assert.equal(feed._aig.synthetic, false);
      assert.equal(feed.items.find(r => r.id === resource.id)!._aig.synthetic, false);
      assert.equal(feed.items.find(r => r.id === demo.id)!._aig.synthetic, true);
      await assert.rejects(client.publish(resource, randomBytes(32).toString('hex')), status(401));
      await assert.rejects(client.publish({ ...resource, publisher: { id: 'urn:publisher:unapproved', name: '【合成测试】其他范围' } }, token), status(403));
    });
    const updated = parseResource({ ...structuredClone(resource), revision: 2, updated_at: new Date().toISOString(),
      representations: [{ media_type: 'text/markdown', derivation: 'original', content_text: '【合成测试更新】\r\n**完整正文** 🌐\t  ' }] });
    const expectationPath = join(folder, 'reader.json');
    await t.test('Credential-free reader CLI catches body and origin mismatches', async () => {
      await client.publish(updated, token);
      const expected = { schema_version: 'aig-reader-expectation/1', origin: client.base.origin, gateway_synthetic: false, resources: [updated, demo] };
      await writeJSON(expectationPath, expected);
      const output = await cli('scripts/check-reader.ts', ['--expect', expectationPath]);
      assert.equal(JSON.parse(output.stdout).ok, true); assert(!output.stdout.includes(token));
      assert.equal((await checkReader(client, readerExpectation(expected))).checked_resources, 2);
      // The Feed marker is additive. Older feeds can use the required detail marker; unrelated extensions are ignored.
      const compatible = new AigClient(host!.url);
      const originalFeed = compatible.feed.bind(compatible);
      compatible.feed = async () => {
        const feed = await originalFeed() as { items: { _aig: { synthetic?: boolean; future_field?: string } }[] };
        for (const item of feed.items) { delete item._aig.synthetic; item._aig.future_field = 'ignored'; }
        return feed;
      };
      await checkReader(compatible, readerExpectation(expected));
      const altered = structuredClone(expected); altered.resources[0]!.representations[0]!.content_text += '错误';
      await writeJSON(expectationPath, altered);
      await assert.rejects(cli('scripts/check-reader.ts', ['--expect', expectationPath]));
      await writeJSON(expectationPath, { ...expected, origin: 'https://reader.example.invalid' });
      await assert.rejects(cli('scripts/check-reader.ts', ['--expect', expectationPath]));
      await assert.rejects(cli('scripts/check-reader.ts', ['--expect', expectationPath, '--credentials', credentialPath]));
      await assert.rejects(client.publish({ ...updated, synthetic: true, revision: 3 }, token), status(409));
    });
    await t.test('Public-mode D1 restart, withdrawal and old retry preserve identity and do not restore body', async () => {
      await host!.stop(); host = undefined;
      host = await startLocalHosting(directory, 'public'); client = new AigClient(host.url);
      assert.deepEqual(await client.get(resource.id), updated);
      const gone = parseResource({ ...structuredClone(updated), revision: 3, updated_at: new Date().toISOString(), status: 'withdrawn',
        withdrawal_reason: '【合成测试】撤回', representations: [] });
      assert.equal((await client.publish(gone, token)).outcome, 'stored');
      const retry = await client.publish(resource, token);
      assert.deepEqual([retry.outcome, retry.current_revision, retry.current_status], ['unchanged', 3, 'withdrawn']);
      await checkReader(client, readerExpectation({ schema_version: 'aig-reader-expectation/1', origin: client.base.origin,
        gateway_synthetic: false, resources: [gone, demo] }));
      const body = await client.get(resource.id); assert.equal(body.synthetic, false); assert.equal(body.title, undefined);
      assert.deepEqual(body.representations, []);
    });
  } finally {
    if (host) await host.stop();
    await rm(folder, { recursive: true, force: true });
  }
});
