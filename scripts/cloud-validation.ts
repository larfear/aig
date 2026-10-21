import { parseArgs } from 'node:util';
import { join, relative } from 'node:path';
import { localDirectory, root, snapshot } from './lib/preflight.ts';
import { prepareDeployment } from './lib/publisher.ts';
// @ts-expect-error Shared local-only Wrangler wrapper.
import { runWrangler } from './lib/wrangler.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { directory: { type: 'string' } } });
  const action = positionals[0];
  if (positionals.length !== 1 || !['plan', 'bundle'].includes(action!)) throw new Error('Only offline plan or bundle supported');
  const directory = localDirectory(values.directory);
  const { target, actual_target_filled, content_mode, publisher_id } = await prepareDeployment(directory);
  if (action === 'bundle') {
    // Fixed dry-run arguments: this entry point never executes remote commands or public routing.
    runWrangler(['deploy', '--dry-run', '--config', join(directory, 'wrangler.closed.json'),
      '--outdir', join(directory, 'bundle'), '--secrets-file', join(directory, 'secrets.json')]);
    const report = await snapshot(directory);
    console.log(JSON.stringify({ scope: report.scope, source_sha256: report.source_sha256, lock_sha256: report.lock_sha256 }));
  } else {
    const config = relative(root, join(directory, 'wrangler.closed.json'));
    const publicConfig = relative(root, join(directory, 'wrangler.public.json'));
    const cli = ['node', 'node_modules/wrangler/bin/wrangler.js'];
    console.log(JSON.stringify({ scope: 'offline command plan; all remote operations require later authorization',
      origin: target.origin, content_mode, publisher_id, account_id: target.account_id, worker: target.worker_name, database: target.database_name,
      database_id: target.database_id, actual_target_filled, account_ownership_verified: false,
      commands_NOT_EXECUTED: [
        [...cli, 'd1', 'migrations', 'apply', target.database_name, '--remote', '--config', config],
        [...cli, 'deploy', '--config', config, '--secrets-file', relative(root, join(directory, 'secrets.json'))],
        [...cli, 'triggers', 'deploy', '--config', publicConfig],
      ],
      shutdown_REQUIRED: {
        domain: new URL(target.origin).hostname,
        closed_config_removes_existing_custom_domains: false,
        steps_NOT_EXECUTED: [
          'Remove this exact custom-domain binding in the Worker dashboard or Custom Domains API; an empty routes list does not remove an existing binding in the locked CLI',
          'Confirm zero custom domains/routes and workers.dev/preview URLs disabled',
          'Probe manifest, Feed and a resource over fresh HTTPS connections, including a cached DNS address; none may return AIG content',
          'Disable the validation publisher Secret and record retained D1/history plus ongoing Paid fees',
        ],
      } }, null, 2));
  }
} catch { console.error('Offline validation preparation failed; no remote command was executed.'); process.exitCode = 1; }
