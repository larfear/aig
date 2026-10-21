import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publisherCredentials } from '../../src/core/publishers.ts';
import type { Credential } from '../../src/core/publishers.ts';
import { cloudTarget, configuration, hasActualTarget, localDirectory, prepare, writeJSON } from './preflight.ts';
import { readCredentials } from './target.ts';

export function developmentVars(credentials: Credential[]): string {
  // Keep the dotenv value on one line; JSON restores any apostrophe in a publisher URI.
  return `AIG_PUBLISHERS_JSON='${JSON.stringify(credentials).replaceAll("'", '\\u0027')}'\n`;
}

export async function preparePublisher(path: string, publisher_id: string) {
  const directory = localDirectory(path);
  const proposed = publisherCredentials([{ publisher_id, token: randomBytes(32).toString('hex') }]);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const credentialPath = join(directory, 'publisher-credentials.json');
  try { await writeFile(credentialPath, JSON.stringify(proposed, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const credentials = await readCredentials(credentialPath);
  if (credentials.length !== 1 || credentials[0]!.publisher_id !== publisher_id) throw new Error('Publisher directory already belongs to a different scope');
  await chmod(credentialPath, 0o600);
  await writeJSON(join(directory, 'secrets.json'), { AIG_PUBLISHERS_JSON: JSON.stringify(credentials) });
  await writeFile(join(directory, '.dev.vars'), developmentVars(credentials), { mode: 0o600 });
  await chmod(join(directory, '.dev.vars'), 0o600);
  return { directory, credentials, credentialPath };
}


/** Offline only: a dedicated publisher profile never deploys or opens a route. */
export async function preparePublisherProfile(path: string, publisher_id: string, targetPath: string, mode: string = 'synthetic') {
  if (mode !== 'synthetic' && mode !== 'public') throw new Error('Invalid publisher content mode');
  const input = cloudTarget(JSON.parse(await readFile(targetPath, 'utf8')));
  const target = { origin: new URL(input.origin).origin, account_id: input.account_id, worker_name: input.worker_name,
    database_name: input.database_name, database_id: input.database_id,
    request_namespace_id: input.request_namespace_id, auth_namespace_id: input.auth_namespace_id };
  const directory = localDirectory(path);
  const profile = { schema_version: 'aig-publisher-deployment/1', publisher_id, content_mode: mode,
    enabled: false, target };
  let existing;
  try { existing = JSON.parse(await readFile(join(directory, 'deployment-profile.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(profile)) throw new Error('Publisher profile target, scope or mode differs; use a new directory');
  } else if (mode === 'public') {
    try {
      await readFile(join(directory, 'publisher-credentials.json'));
      throw new Error('Use a fresh formal publisher directory; do not reuse local/test keys');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const prepared = await preparePublisher(directory, publisher_id);
  await writeJSON(join(directory, 'target.json'), target);
  await writeJSON(join(directory, 'deployment-profile.json'), profile);
  await writeJSON(join(directory, 'wrangler.closed.json'), configuration(target, directory, false, mode));
  await writeJSON(join(directory, 'wrangler.public.json'), configuration(target, directory, true, mode));
  return { ...prepared, target, actual_target_filled: hasActualTarget(target), content_mode: mode, publisher_id };
}

/** Preserve the existing two-demo validation path when no publisher profile exists. */
export async function prepareDeployment(directory: string) {
  let profile;
  try { profile = JSON.parse(await readFile(join(directory, 'deployment-profile.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!profile) return { ...await prepare(directory), content_mode: 'synthetic', publisher_id: undefined };
  if (profile.schema_version !== 'aig-publisher-deployment/1' || profile.enabled !== false) throw new Error('Invalid offline publisher profile');
  return preparePublisherProfile(directory, profile.publisher_id, join(directory, 'target.json'), profile.content_mode);
}
