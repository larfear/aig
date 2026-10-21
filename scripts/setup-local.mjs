import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from './lib/wrangler.mjs';
const directory = resolve(root, '.local');
const path = resolve(directory, 'publisher-credentials.json');
await mkdir(resolve(directory, 'demo/source'), { recursive: true });
let list;
try { list = JSON.parse(await readFile(path, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  list = ['demo-announcements', 'demo-notes'].map(name => ({
    publisher_id: `urn:aig:publisher:${name}`, token: randomBytes(32).toString('hex'),
  }));
  await writeFile(path, JSON.stringify(list, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
const varsPath = resolve(root, '.dev.vars');
let original = '';
try { original = await readFile(varsPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const lines = original.split('\n').filter(line => line && !line.startsWith('AIG_PUBLISHERS_JSON='));
lines.push(`AIG_PUBLISHERS_JSON='${JSON.stringify(list)}'`);
await writeFile(varsPath, lines.join('\n') + '\n', { mode: 0o600 });
console.log('Prepared local synthetic publishers; credentials remain in ignored files.');
