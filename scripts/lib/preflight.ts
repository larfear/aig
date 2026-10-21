import { randomBytes, createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseURL, loopback } from '../../src/core/base-url.ts';
import { readCredentials } from './target.ts';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const publishers = ['urn:aig:publisher:demo-announcements', 'urn:aig:publisher:demo-notes'];
export interface ValidationTarget {
  origin: string; account_id: string; worker_name: string; database_name: string; database_id: string;
  request_namespace_id: string; auth_namespace_id: string;
}
export function localDirectory(value = '.local/controlled-validation'): string {
  const path = resolve(root, value);
  const rel = relative(resolve(root, '.local'), path);
  if (rel === '' || rel.startsWith('..') || rel.startsWith('/')) throw new Error('Use a dedicated directory inside .local');
  return path;
}
export function cloudTarget(value: unknown): ValidationTarget {
  const t = value as ValidationTarget | null;
  if (!t || typeof t.origin !== 'string' || baseURL(t.origin).protocol !== 'https:' ||
      loopback(baseURL(t.origin).hostname) || baseURL(t.origin).port ||
      !/^[a-f0-9]{32}$/.test(t.account_id) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(t.database_id) ||
      !/^[a-z][a-z0-9-]{0,62}$/.test(t.worker_name) || !/^[a-z][a-z0-9-]{0,62}$/.test(t.database_name) ||
      !/^[1-9][0-9]{0,8}$/.test(t.request_namespace_id) || !/^[1-9][0-9]{0,8}$/.test(t.auth_namespace_id) ||
      t.request_namespace_id === t.auth_namespace_id) throw new Error('Invalid validation account, resource or single HTTPS target');
  return t;
}
export function hasActualTarget(t: ValidationTarget): boolean {
  return !/^0+$/.test(t.account_id) && !/^0+$/.test(t.database_id.replaceAll('-', '')) &&
    !baseURL(t.origin).hostname.endsWith('.invalid');
}
export function configuration(t: ValidationTarget, directory: string, publicRoute = false, mode: 'synthetic' | 'public' = 'synthetic') {
  if (!['synthetic', 'public'].includes(mode)) throw new Error('Invalid publisher content mode');
  return {
    $schema: relative(directory, join(root, 'node_modules/wrangler/config-schema.json')),
    name: t.worker_name, account_id: t.account_id, main: relative(directory, join(root, 'src/worker.ts')),
    compatibility_date: '2026-10-12', workers_dev: false, preview_urls: false, send_metrics: false,
    vars: { AIG_CONTENT_MODE: mode },
    routes: publicRoute ? [{ pattern: baseURL(t.origin).hostname, custom_domain: true }] : [],
    limits: { cpu_ms: 50 }, secrets: { required: ['AIG_PUBLISHERS_JSON'] },
    d1_databases: [{ binding: 'DB', database_name: t.database_name, database_id: t.database_id,
      remote: false, migrations_dir: relative(directory, join(root, 'migrations')) }],
    ratelimits: [
      { name: 'REQUEST_LIMIT', namespace_id: t.request_namespace_id, simple: { limit: 120, period: 60 } },
      { name: 'AUTH_LIMIT', namespace_id: t.auth_namespace_id, simple: { limit: 5, period: 60 } },
    ],
  };
}
export async function writeJSON(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
}
export async function prepare(directory: string) {
  await mkdir(directory, { recursive: true });
  const targetPath = join(directory, 'target.json');
  try { await writeFile(targetPath, await readFile(join(root, 'dev/validation-target.example.json')), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const target = cloudTarget(JSON.parse(await readFile(targetPath, 'utf8')));
  const credentialPath = join(directory, 'publisher-credentials.json');
  try {
    await writeFile(credentialPath, JSON.stringify(publishers.map(publisher_id => ({
      publisher_id, token: randomBytes(32).toString('hex'),
    })), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const credentials = await readCredentials(credentialPath);
  if (credentials.length !== 2 || publishers.some(id => !credentials.some(c => c.publisher_id === id))) {
    throw new Error('Validation needs the two synthetic publisher scopes');
  }
  await chmod(credentialPath, 0o600);
  await writeJSON(join(directory, 'secrets.json'), { AIG_PUBLISHERS_JSON: JSON.stringify(credentials) });
  await writeJSON(join(directory, 'wrangler.closed.json'), configuration(target, directory));
  await writeJSON(join(directory, 'wrangler.public.json'), configuration(target, directory, true));
  return { target, directory, actual_target_filled: hasActualTarget(target) };
}

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function fileList(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fileList(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error('Unexpected source entry');
  }
  return files.sort();
}
export async function snapshot(directory: string) {
  const paths = ['README.md', 'AGENTS.md', '.gitignore', '.npmrc', '.node-version', '.nvmrc', 'package.json', 'package-lock.json',
    'tsconfig.json', 'tsconfig.worker.json', 'wrangler.local.jsonc', 'wrangler.hosting.local.jsonc'].map(path => join(root, path));
  for (const folder of ['src', 'scripts', 'schemas', 'migrations', 'examples', 'dev', 'tests', 'docs']) {
    paths.push(...await fileList(join(root, folder)));
  }
  const files = await Promise.all(paths.sort().map(async path => ({ path: relative(root, path), sha256: hash(await readFile(path)) })));
  const bundle = await Promise.all((await fileList(join(directory, 'bundle'))).map(async path => ({
    path: relative(directory, path), sha256: hash(await readFile(path)),
  })));
  const report = { checked_at: new Date().toISOString(), scope: 'offline source and bundle only; cloud/public NOT_RUN',
    source_sha256: hash(JSON.stringify(files)), lock_sha256: hash(await readFile(join(root, 'package-lock.json'))), files, bundle };
  await writeJSON(join(directory, 'source-snapshot.json'), report);
  return report;
}
