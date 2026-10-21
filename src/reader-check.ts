import { AigClient } from './client.ts';
import { baseURL } from './core/base-url.ts';
import { canonical, MAX_FEED_ITEMS, parseResource, primaryText, tombstone } from './core/resource.ts';
import type { Resource } from './core/resource.ts';

export interface ReaderExpectation {
  schema_version: 'aig-reader-expectation/1';
  origin: string;
  gateway_synthetic: boolean;
  resources: Resource[];
}

export function readerExpectation(value: unknown): ReaderExpectation {
  const e = value as ReaderExpectation | null;
  if (!e || e.schema_version !== 'aig-reader-expectation/1' || typeof e.origin !== 'string' ||
      typeof e.gateway_synthetic !== 'boolean' || !Array.isArray(e.resources) ||
      e.resources.length < 1 || e.resources.length > MAX_FEED_ITEMS) throw new Error('Invalid reader expectation');
  const resources = e.resources.map(parseResource);
  if (new Set(resources.map(r => r.id)).size !== resources.length || (e.gateway_synthetic && resources.some(r => !r.synthetic))) {
    throw new Error('Reader expectation has duplicate IDs or inconsistent content mode');
  }
  return { schema_version: e.schema_version, origin: baseURL(e.origin).origin, gateway_synthetic: e.gateway_synthetic, resources };
}

export async function checkReader(client: AigClient, expected: ReaderExpectation) {
  const same = (a: unknown, b: unknown, label: string) => { if (canonical(a) !== canonical(b)) throw new Error(label); };
  if (client.base.origin !== expected.origin) throw new Error('Reader origin mismatch');
  const base = client.base.href;
  const manifest = await client.manifest() as { base_url: string; feed_url: string; resource_url_template: string; synthetic: boolean; experimental: boolean };
  same([manifest.base_url, manifest.feed_url, manifest.resource_url_template, manifest.synthetic, manifest.experimental],
    [base, `${base}feed.json`, `${base}items/{id}.json`, expected.gateway_synthetic, true], 'Manifest target or content mode mismatch');
  const feed = await client.feed() as { feed_url: string; _aig: { synthetic: boolean }; items: { id: string; url: string;
    content_text: string; date_published: string; date_modified: string; _aig: { resource_url: string; revision: number;
    synthetic: boolean; publisher: unknown; source: unknown; representations: unknown } }[] };
  same([feed.feed_url, feed._aig.synthetic], [`${base}feed.json`, expected.gateway_synthetic], 'Feed target or content mode mismatch');
  for (const resource of expected.resources) {
    const actual = await client.get(resource.id);
    same(actual, resource.status === 'withdrawn' ? tombstone(resource) : resource, 'Resource body, source, identity or revision mismatch');
    const items = feed.items.filter(item => item.id === resource.id);
    if (resource.status === 'withdrawn') same(items, [], 'Withdrawn item still present in Feed');
    else {
      if (items.length !== 1) throw new Error('Expected exactly one Feed item');
      const item = items[0]!;
      same([item.url, item.content_text, item.date_published, item.date_modified, item._aig.resource_url, item._aig.revision,
        item._aig.synthetic ?? actual.synthetic, item._aig.publisher, item._aig.source, item._aig.representations],
        [`${base}items/${resource.id}.json`, primaryText(resource), resource.published_at, resource.updated_at,
          `${base}items/${resource.id}.json`, resource.revision, resource.synthetic,
          resource.publisher, resource.source, resource.representations], 'Feed body, source, revision or synthetic label mismatch');
    }
  }
  const response = await fetch(new URL('feed.json', client.base), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  await response.body?.cancel();
  if (response.status !== 200 || response.headers.get('cache-control') !== 'no-store') throw new Error('Feed must be 200/no-store');
  return { checked_resources: expected.resources.length,
    published_resources: expected.resources.filter(r => r.status === 'published').length,
    withdrawn_resources: expected.resources.filter(r => r.status === 'withdrawn').length,
    checks: ['manifest/Feed origin and mode', 'full text/source/identity/revision',
      'per-resource synthetic labels', 'expected status and Feed membership (410/tombstone for withdrawn)', 'Feed no-store'] };
}
