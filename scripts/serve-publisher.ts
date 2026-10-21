import { parseArgs } from 'node:util';
import { contentMode } from '../src/core/content-mode.ts';
import { startLocalHosting } from './lib/local-host.ts';

let host: Awaited<ReturnType<typeof startLocalHosting>> | undefined;
try {
  const { values } = parseArgs({ options: { directory: { type: 'string' },
    'content-mode': { type: 'string', default: 'synthetic' }, port: { type: 'string', default: '8787' } } });
  if (!values.directory) throw new Error('Use --directory .local/selected-publisher');
  const mode = contentMode(values['content-mode']);
  host = await startLocalHosting(values.directory, mode, Number(values.port));
  console.log(JSON.stringify({ scope: 'loopback Worker and local D1 only; no cloud deployment', origin: host.url,
    content_mode: mode, stop: 'Ctrl+C; local D1 and publisher credentials remain for the next run' }));
  await new Promise<void>(done => { for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => done()); });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local publisher server failed');
  process.exitCode = 1;
} finally { if (host) await host.stop(); }
