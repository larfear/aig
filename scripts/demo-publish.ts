import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { publishFile } from '../src/adapters/file.ts';
import { MAX_RESOURCE_BYTES, parseResource } from '../src/core/resource.ts';
import { AigClient } from '../src/client.ts';
import { readCredentials, targetURL } from './lib/target.ts';
import { allowContent, contentMode } from '../src/core/content-mode.ts';
const { values } = parseArgs({ options: {
  file: { type: 'string' }, source: { type: 'string' }, url: { type: 'string' }, credentials: { type: 'string' }, target: { type: 'string' },
  'content-mode': { type: 'string', default: 'synthetic' },
} });
try {
  if (!values.file || Boolean(values.source) === Boolean(values.url || values.target)) throw new Error('Choose --file and exactly one of --source or --url/--target');
  if (values.source && (values.target || values.credentials)) throw new Error('File publishing does not use a validation target or credentials');
  const bytes = await readFile(values.file);
  if (bytes.byteLength > MAX_RESOURCE_BYTES) throw new Error('Resource too large');
  const resource = parseResource(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  allowContent(resource, contentMode(values['content-mode']));
  if (values.source) {
    console.log(JSON.stringify(await publishFile(resolve(values.source), resource)));
  } else {
    const url = await targetURL(values.url, values.target);
    if (values.target && !values.credentials) throw new Error('Validation publishing requires an explicit --credentials file');
    const credentials = await readCredentials(values.credentials ?? '.local/publisher-credentials.json');
    const credential = credentials.find(c => c.publisher_id === resource.publisher.id);
    if (!credential) throw new Error('No credential for this publisher');
    console.log(JSON.stringify(await new AigClient(url.href).publish(resource, credential.token)));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Publish failed');
  process.exitCode = 1;
}
