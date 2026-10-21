import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';

const require = createRequire(import.meta.url);
const addFormats: (ajv: Ajv2020) => void = require('ajv-formats');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

async function readJSON(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
}

const groups = [
  { schema: 'schemas/resource.schema.json', examples: ['examples/resources/demo-announcement-001.json', 'examples/resources/demo-note-001.json', 'examples/scenarios/demo-announcement-001-updated.json', 'examples/scenarios/demo-announcement-001-withdrawn.json'] },
  { schema: 'schemas/manifest.schema.json', examples: ['examples/manifest.json'] },
  { schema: 'schemas/feed-profile.schema.json', examples: ['examples/feed.json'] },
];
const loaded = new Map<string, unknown>();
let count = 0;
for (const group of groups) {
  const schema = await readJSON(group.schema);
  assert(schema && typeof schema === 'object');
  const validate = ajv.compile(schema);
  for (const path of group.examples) {
    const value = await readJSON(path);
    assert(validate(value), `${path}: ${ajv.errorsText(validate.errors)}`);
    loaded.set(path, value);
    count += 1;
    console.log(`PASS ${path}`);
  }
}

interface ResourceExample {
  id: string;
  revision: number;
  published_at: string;
  updated_at: string;
  synthetic: boolean;
  representations: { content_text?: string }[];
}
interface FeedExample {
  feed_url: string;
  _aig: { synthetic: boolean };
  items: { id: string; content_text: string; _aig: { revision: number; resource_url: string; synthetic: boolean } }[];
}
interface ManifestExample {
  synthetic: boolean;
  base_url: string;
  feed_url: string;
  resource_url_template: string;
}

const resources = ['demo-announcement-001', 'demo-note-001'].map(id =>
  loaded.get(`examples/resources/${id}.json`) as ResourceExample);
const withdrawn = loaded.get('examples/scenarios/demo-announcement-001-withdrawn.json') as ResourceExample;
const updated = loaded.get('examples/scenarios/demo-announcement-001-updated.json') as ResourceExample;
for (const resource of [...resources, updated, withdrawn]) {
  assert.equal(resource.synthetic, true, 'Only synthetic fixtures belong in examples');
  assert(Date.parse(resource.updated_at) >= Date.parse(resource.published_at), 'Timestamps must be ordered');
}
assert.equal(withdrawn.id, resources[0].id, 'Withdrawal must keep the resource ID');
assert.equal(withdrawn.published_at, resources[0].published_at, 'First publication time must be stable');
assert(withdrawn.revision > resources[0].revision, 'Withdrawal must advance the resource revision');
assert.equal(updated.id, resources[0].id);
assert.equal(updated.published_at, resources[0].published_at);
assert.equal(updated.revision, resources[0].revision + 1);
assert.equal(withdrawn.revision, updated.revision + 1);
const feed = loaded.get('examples/feed.json') as FeedExample;
const manifest = loaded.get('examples/manifest.json') as ManifestExample;
assert.equal(feed._aig.synthetic, true);
assert.equal(manifest.synthetic, true);
assert.equal(feed.feed_url, manifest.feed_url);
assert.equal(new Set(feed.items.map(item => item.id)).size, feed.items.length, 'Feed IDs must be unique');
for (const item of feed.items) {
  const resource = resources.find(resource => resource.id === item.id);
  assert(resource, 'Feed item must reference a published example');
  assert.equal(item._aig.revision, resource.revision);
  assert.equal(item._aig.synthetic, resource.synthetic);
  assert.equal(item.content_text, resource.representations[0].content_text);
  assert.equal(item._aig.resource_url, manifest.resource_url_template.replace('{id}', item.id));
}
for (const url of [manifest.base_url, manifest.feed_url, ...feed.items.map(item => item._aig.resource_url)]) {
  assert(new URL(url).hostname.endsWith('.invalid'), 'Fixture endpoints must use a reserved domain');
}
console.log(`PASS ${count} examples: schema, references, content consistency and withdrawal metadata`);
console.log('Scope: local draft examples only; no HTTP, source authorization, durable replay or agent interoperability verified.');
