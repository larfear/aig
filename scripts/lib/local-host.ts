import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { contentMode } from '../../src/core/content-mode.ts';
import type { ContentMode } from '../../src/core/content-mode.ts';
import { localDirectory, root } from './preflight.ts';
import { readCredentials } from './target.ts';
// @ts-expect-error Shared wrapper clears cloud credentials and only receives fixed local arguments here.
import { startWrangler } from './wrangler.mjs';

export async function startLocalHosting(path: string, mode: ContentMode = 'synthetic', requestedPort?: number) {
  const directory = localDirectory(path);
  contentMode(mode);
  await readCredentials(join(directory, 'publisher-credentials.json'));
  const config = JSON.parse(await readFile(join(root, 'wrangler.hosting.local.jsonc'), 'utf8'));
  delete config.tsconfig; delete config.$schema;
  config.main = relative(directory, join(root, 'src/worker.ts'));
  config.vars = { AIG_CONTENT_MODE: mode };
  config.routes = []; config.workers_dev = false; config.preview_urls = false;
  config.d1_databases[0].migrations_dir = relative(directory, join(root, 'migrations'));
  const configPath = join(directory, 'wrangler.local.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  const state = join(directory, 'state');
  const migration = startWrangler(['d1', 'migrations', 'apply', 'aig-local', '--config', configPath, '--local', '--persist-to', state]);
  migration.stdout.resume(); migration.stderr.resume();
  if ((await once(migration, 'close'))[0] !== 0) throw new Error('Local publisher D1 migration failed');
  let port = requestedPort;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid local port');
  if (port === undefined) {
    const portServer = createServer().listen(0, '127.0.0.1');
    await once(portServer, 'listening');
    port = (portServer.address() as { port: number }).port;
    await new Promise<void>(done => portServer.close(() => done()));
  }
  const child = startWrangler(['dev', '--config', configPath, '--local', '--ip', '127.0.0.1', '--port', String(port),
    '--inspector-port', '0', '--persist-to', state, '--show-interactive-dev-session', 'false']);
  child.stdout.resume(); child.stderr.resume();
  const closed = once(child, 'close');
  const url = `http://127.0.0.1:${port}/`;
  const stop = async () => {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(timer); }
  };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`${url}manifest.json`, { signal: AbortSignal.timeout(1000) });
        const manifest = await response.json() as { synthetic?: boolean };
        if (response.status === 200 && manifest.synthetic === (mode === 'synthetic')) return { url, stop };
      } catch { /* Wait only for this loopback Worker. */ }
      await delay(100);
    }
    throw new Error('Local publisher Worker did not become ready');
  } catch (error) { await stop(); throw error; }
}
