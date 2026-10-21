import { D1Source } from './adapters/d1.ts';
import { boundedJSON, failure, json, readGateway } from './core/http.ts';
import { AigError, ID, parseResource } from './core/resource.ts';
import { allowContent, contentMode } from './core/content-mode.ts';
import { publisherCredentials } from './core/publishers.ts';
import type { Credential } from './core/publishers.ts';

type HostingEnv = Omit<Env, 'AIG_PUBLISHERS_JSON' | 'AIG_CONTENT_MODE'> & { AIG_PUBLISHERS_JSON?: string; AIG_CONTENT_MODE?: string };
function credentials(value: string | undefined): Credential[] {
  try {
    return publisherCredentials(JSON.parse(value ?? ''));
  } catch { throw new AigError(503, 'publisher_configuration_unavailable'); }
}
async function sameToken(a: string, b: string): Promise<boolean> {
  const hash = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [left, right] = await Promise.all([hash(a), hash(b)]);
  const l = new Uint8Array(left), r = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < l.length; i++) difference |= l[i]! ^ r[i]!;
  return difference === 0;
}
async function owner(request: Request, env: HostingEnv): Promise<string> {
  const header = request.headers.get('authorization') ?? '';
  let found: string | undefined;
  if (/^Bearer [a-f0-9]{64}$/.test(header)) {
    for (const c of credentials(env.AIG_PUBLISHERS_JSON)) {
      if (await sameToken(header.slice(7), c.token)) found = c.publisher_id;
    }
  }
  if (!found) {
    if (!(await env.AUTH_LIMIT.limit({ key: 'invalid-auth' })).success) throw new AigError(429, 'authentication_rate_limited');
    throw new AigError(401, 'unauthorized');
  }
  return found;
}
export default {
  async fetch(request: Request, env: HostingEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new AigError(400, 'https_required');
      if (!(await env.REQUEST_LIMIT.limit({ key: 'gateway' })).success) throw new AigError(429, 'rate_limited');
      const mode = contentMode(env.AIG_CONTENT_MODE);
      const source = new D1Source(env.DB);
      if (!url.pathname.startsWith('/publish/')) return await readGateway(request, source, mode);
      const match = /^\/publish\/items\/([^/]+)\.json$/.exec(url.pathname);
      if (!match) throw new AigError(404, 'not_found');
      if (request.method !== 'PUT') return json({ error: { code: 'method_not_allowed' } }, 405, { Allow: 'PUT' });
      if (url.search || !ID.test(match[1]!)) throw new AigError(400, 'invalid_publish_target');
      const publisher = await owner(request, env);
      const resource = parseResource(await boundedJSON(request));
      if (resource.id !== match[1]) throw new AigError(422, 'resource_id_mismatch');
      if (resource.publisher.id !== publisher) throw new AigError(403, 'publisher_scope_denied');
      allowContent(resource, mode);
      const existing = await source.get(resource.id);
      if (existing && existing.publisher.id !== publisher) throw new AigError(403, 'publisher_scope_denied');
      return json(await source.save(resource));
    } catch (error) { return failure(error); }
  },
} satisfies ExportedHandler<HostingEnv>;
