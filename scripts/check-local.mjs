import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { devArgs, initArgs, root, runWrangler, startWrangler } from './lib/wrangler.mjs';

const expected = 'AIG 合成本地环境检查\n第二行：完整保存；不代表业务链路验收。\nhttps://publisher.invalid/environment';
const checks = [];
runWrangler(initArgs);

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

async function probe(label) {
  const port = await availablePort();
  const worker = startWrangler([...devArgs, '--port', String(port), '--inspector-port', '0']);
  let output = '';
  let spawnError;
  worker.on('error', error => { spawnError = error; });
  for (const stream of [worker.stdout, worker.stderr]) {
    stream.on('data', chunk => { output = (output + chunk.toString()).slice(-12000); });
  }
  const closed = once(worker, 'close');
  const url = `http://127.0.0.1:${port}`;
  try {
    let response;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (worker.exitCode !== null) throw new Error(`Wrangler exited before readiness:\n${output}`);
      try {
        response = await fetch(`${url}/__local/health`, { signal: AbortSignal.timeout(1000) });
        break;
      } catch { await delay(100); }
    }
    assert(response, `Local Worker did not become ready:\n${output}`);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), {
      project: 'AIG', scope: 'environment-only', synthetic: true, database: 'local-d1', content_text: expected,
    });
    assert.equal((await fetch(`${url}/missing`)).status, 404);
    assert.equal((await fetch(`${url}/__local/health`, { method: 'POST' })).status, 405);
    checks.push(label);
    console.log(`PASS ${label}`);
  } finally {
    worker.kill('SIGTERM');
    const timeout = setTimeout(() => worker.kill('SIGKILL'), 5000);
    try { await closed; } finally { clearTimeout(timeout); }
  }
}

await probe('Local Workers HTTP → D1 synthetic text read, with explicit 404/405');
// Do not seed again: a second process must read the data saved before the first started.
await probe('Local D1 text survives a Worker restart');
await mkdir(resolve(root, '.local'), { recursive: true });
await writeFile(resolve(root, '.local/local-check.json'), JSON.stringify({
  checked_at: new Date().toISOString(), ok: true, scope: 'local environment only',
  synthetic: true, checks,
}, null, 2) + '\n');
console.log('Scope: environment probe only; no AIG publishing, authorization, hosting or public deployment acceptance.');
