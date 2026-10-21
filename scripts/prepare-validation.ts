import { parseArgs } from 'node:util';
import { localDirectory, prepare } from './lib/preflight.ts';
try {
  const { values } = parseArgs({ options: { directory: { type: 'string' } } });
  const result = await prepare(localDirectory(values.directory));
  console.log(JSON.stringify({ scope: 'local preparation only', directory: result.directory,
    actual_target_filled: result.actual_target_filled, cloud_resources_created: false, credentials_printed: false }));
} catch { console.error('Validation preparation failed; check the target and local files.'); process.exitCode = 1; }
