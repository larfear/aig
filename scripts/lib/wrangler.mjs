import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const config = resolve(root, 'wrangler.local.jsonc');
export const state = resolve(root, '.local/cloudflare/state');
const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');

function localOptions() {
  const env = { ...process.env };
  // Local checks never need inherited Cloudflare credentials or selected cloud environments.
  for (const key of Object.keys(env)) {
    if (/^(CLOUDFLARE_|CF_|WRANGLER_|AIG_)/.test(key)) delete env[key];
  }
  Object.assign(env, {
    XDG_CONFIG_HOME: resolve(root, '.local/cloudflare/config'),
    XDG_CACHE_HOME: resolve(root, '.cache/cloudflare'),
    WRANGLER_LOG_PATH: resolve(root, '.local/cloudflare/logs'),
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false',
    WRANGLER_HIDE_BANNER: 'true',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CI: 'true',
  });
  mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });
  mkdirSync(env.WRANGLER_LOG_PATH, { recursive: true });
  return { cwd: root, env };
}

export function runWrangler(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { ...localOptions(), stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Local Wrangler command failed (${result.status ?? result.signal})`);
}

export function startWrangler(args) {
  return spawn(process.execPath, [cli, ...args], { ...localOptions(), stdio: ['ignore', 'pipe', 'pipe'] });
}

export const devArgs = ['dev', '--config', config, '--local', '--ip', '127.0.0.1',
  '--persist-to', state, '--show-interactive-dev-session', 'false'];
export const initArgs = ['d1', 'execute', 'aig-local', '--config', config, '--local',
  '--persist-to', state, '--file', resolve(root, 'dev/db/environment.sql')];
