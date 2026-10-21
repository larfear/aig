import { config, devArgs, initArgs, root, runWrangler, state } from './lib/wrangler.mjs';
import { resolve } from 'node:path';

const commands = {
  version: ['--version'],
  types: ['types', resolve(root, '.local/worker-configuration.d.ts'), '--config', resolve(root, 'wrangler.hosting.local.jsonc')],
  'db:init': initArgs,
  'db:check': ['d1', 'execute', 'aig-local', '--config', config, '--local', '--persist-to', state,
    '--command', "SELECT id, body FROM aig_environment_probe WHERE id = 'synthetic-probe'"],
  dev: devArgs,
  'hosting:dev': ['dev', '--config', resolve(root, 'wrangler.hosting.local.jsonc'), '--local', '--ip', '127.0.0.1',
    '--persist-to', state, '--show-interactive-dev-session', 'false'],
  'hosting:migrate': ['d1', 'migrations', 'apply', 'aig-local', '--config', resolve(root, 'wrangler.hosting.local.jsonc'),
    '--local', '--persist-to', state],
};
const args = commands[process.argv[2]];
if (!args || process.argv.length !== 3) {
  console.error(`Choose one local task: ${Object.keys(commands).join(', ')}. No extra arguments accepted.`);
  process.exitCode = 1;
} else {
  runWrangler(args);
}
