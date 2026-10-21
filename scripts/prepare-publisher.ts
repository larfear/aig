import { parseArgs } from 'node:util';
import { join, relative } from 'node:path';
import { preparePublisher, preparePublisherProfile } from './lib/publisher.ts';
import { root } from './lib/preflight.ts';

try {
  const { values } = parseArgs({ options: { 'publisher-id': { type: 'string' }, directory: { type: 'string' }, target: { type: 'string' }, 'content-mode': { type: 'string' } } });
  if (!values['publisher-id'] || !values.directory) throw new Error('Use --publisher-id URI --directory .local/selected-publisher');
  if (values['content-mode'] && !values.target) throw new Error('Use --target with --content-mode');
  const prepared = values.target
    ? await preparePublisherProfile(values.directory, values['publisher-id'], values.target, values['content-mode'] ?? 'synthetic')
    : await preparePublisher(values.directory, values['publisher-id']);
  console.log(JSON.stringify({ scope: 'local files only; no cloud activation or deployment', publisher_id: values['publisher-id'],
    deployment_profile: values.target ? relative(root, join(prepared.directory, 'deployment-profile.json')) : null,
    credentials: relative(root, prepared.credentialPath), secrets: relative(root, join(prepared.directory, 'secrets.json')) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Publisher preparation failed');
  process.exitCode = 1;
}
