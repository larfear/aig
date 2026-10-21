import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AigClient } from '../src/client.ts';
import { checkReader, readerExpectation } from '../src/reader-check.ts';
import { loopback } from '../src/core/base-url.ts';
import { targetURL } from './lib/target.ts';

try {
  const { values } = parseArgs({ options: { expect: { type: 'string' }, url: { type: 'string' }, target: { type: 'string' } } });
  if (!values.expect) throw new Error('Use --expect reader-expectation.json');
  const bytes = await readFile(values.expect);
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Reader expectation too large');
  const expected = readerExpectation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  const url = await targetURL(values.url ?? expected.origin, values.target);
  const result = await checkReader(new AigClient(url.href), expected);
  console.log(JSON.stringify({ ok: true, origin: url.origin, checked_at: new Date().toISOString(),
    scope: loopback(url.hostname) ? 'local read-only client; public network NOT_RUN' : 'selected public endpoint read-only; client geography not established',
    ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Reader check failed' }));
  process.exitCode = 1;
}
