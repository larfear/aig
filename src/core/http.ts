import { AigError, ID, MAX_FEED_ITEMS, MAX_RESOURCE_BYTES, MAX_RESPONSE_BYTES, primaryText, tombstone } from './resource.ts';
import type { Source } from './resource.ts';
import { contentMode } from './content-mode.ts';
import type { ContentMode } from './content-mode.ts';

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new AigError(503, 'response_too_large');
  return new Response(body, { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
export function failure(error: unknown): Response {
  const e = error instanceof AigError ? error : new AigError(503, 'source_unavailable');
  return json({ error: { code: e.code } }, e.status,
    e.status === 429 ? { 'Retry-After': '60' } : e.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
}
export async function boundedJSON(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new AigError(415, 'json_required');
  }
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESOURCE_BYTES)) throw new AigError(413, 'request_too_large');
  if (!request.body) throw new AigError(400, 'invalid_json');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESOURCE_BYTES) { await reader.cancel(); throw new AigError(413, 'request_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new AigError(400, 'invalid_json'); }
}
export async function readGateway(request: Request, source: Source, mode: ContentMode = 'synthetic'): Promise<Response> {
  contentMode(mode);
  const url = new URL(request.url);
  if (url.search) throw new AigError(400, 'query_not_supported');
  const match = /^\/items\/([^/]+)\.json$/.exec(url.pathname);
  if (!match && !['/manifest.json', '/feed.json'].includes(url.pathname)) throw new AigError(404, 'not_found');
  if (request.method !== 'GET') return json({ error: { code: 'method_not_allowed' } }, 405, { Allow: 'GET' });
  if (match) {
    if (!ID.test(match[1]!)) throw new AigError(400, 'invalid_id');
    const resource = await source.get(match[1]!);
    if (!resource) throw new AigError(404, 'not_found');
    if (mode === 'synthetic' && !resource.synthetic) throw new AigError(503, 'source_content_mode_mismatch');
    return resource.status === 'withdrawn' ? json(tombstone(resource), 410) : json(resource);
  }
  const base = `${url.origin}/`;
  if (url.pathname === '/manifest.json') return json({
    schema_version: 'aig-manifest/0.1-draft', name: mode === 'synthetic' ? 'AIG synthetic gateway' : 'AIG publisher gateway', experimental: true,
    synthetic: mode === 'synthetic', base_url: base, feed_url: `${base}feed.json`, resource_url_template: `${base}items/{id}.json`,
    capabilities: { resources: true, json_feed: true, changes: false, subscriptions: false, search: false, mcp: false },
  });
  const resources = await source.list();
  if (resources.length > MAX_FEED_ITEMS) throw new AigError(503, 'feed_capacity_exceeded');
  if (mode === 'synthetic' && resources.some(r => !r.synthetic)) throw new AigError(503, 'source_content_mode_mismatch');
  const published = resources.filter(r => r.status === 'published').sort((a, b) =>
    Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id));
  return json({ version: 'https://jsonfeed.org/version/1.1', title: mode === 'synthetic' ? 'AIG synthetic feed' : 'AIG publisher feed',
    home_page_url: base, feed_url: `${base}feed.json`, _aig: { synthetic: mode === 'synthetic' }, items: published.map(r => ({
      id: r.id, url: `${base}items/${r.id}.json`, ...(r.title ? { title: r.title } : {}),
      content_text: primaryText(r), date_published: r.published_at, date_modified: r.updated_at,
      _aig: { resource_url: `${base}items/${r.id}.json`, revision: r.revision, synthetic: r.synthetic,
        publisher: r.publisher, source: r.source, representations: r.representations },
    })) }, 200, { 'Content-Type': 'application/feed+json; charset=utf-8' });
}
