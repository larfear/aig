import { parseArgs } from 'node:util';
import { AigClient } from '../src/client.ts';
import { targetURL } from './lib/target.ts';
const { values } = parseArgs({ options: { url: { type: 'string' }, id: { type: 'string' }, target: { type: 'string' } } });
try {
  const client = new AigClient((await targetURL(values.url, values.target)).href);
  console.log(JSON.stringify(values.id ? await client.get(values.id) : {
    manifest: await client.manifest(), feed: await client.feed(),
  }, null, 2));
} catch (error) { console.error(error instanceof Error ? error.message : 'Read failed'); process.exitCode = 1; }
