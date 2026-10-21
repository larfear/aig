import { feed as validateFeed, manifest as validateManifest } from '../.local/validators.mjs';
import { canonical, ID, MAX_RESPONSE_BYTES, parseResource } from './core/resource.ts';
import type { Receipt, Resource } from './core/resource.ts';
import { baseURL } from './core/base-url.ts';

export class AigHttpError extends Error {
  readonly status: number;
  constructor(status: number) { super(`AIG HTTP ${status}`); this.status = status; }
}

export class AigClient {
  readonly base: URL;
  constructor(base: string) {
    this.base = baseURL(base);
  }
  private async read(path: string, gone = false, init: RequestInit = {}): Promise<{ value: unknown; status: number }> {
    const response = await fetch(new URL(path, this.base), { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.status !== 200 && !(gone && response.status === 410)) {
      await response.body?.cancel();
      throw new AigHttpError(response.status);
    }
    if (!response.headers.get('content-type')?.match(/^application\/(?:json|feed\+json)(?:;|$)/i) || !response.body) {
      await response.body?.cancel();
      throw new Error('AIG JSON response required');
    }
    const reader = response.body!.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('AIG response too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const value of chunks) { bytes.set(value, offset); offset += value.byteLength; }
    try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), status: response.status }; }
    catch { throw new Error('Invalid AIG JSON response'); }
  }
  async get(id: string) {
    if (!ID.test(id)) throw new Error('Invalid resource ID');
    const { value, status } = await this.read(`items/${id}.json`, true);
    const resource = parseResource(value);
    if (resource.id !== id) throw new Error('AIG resource ID mismatch');
    if ((status === 410) !== (resource.status === 'withdrawn')) throw new Error('AIG resource status mismatch');
    return resource;
  }
  async manifest() {
    const { value } = await this.read('manifest.json');
    if (!validateManifest(value)) throw new Error('Invalid AIG manifest');
    return value;
  }
  async feed() {
    const { value } = await this.read('feed.json');
    if (!validateFeed(value)) throw new Error('Invalid AIG feed');
    return value;
  }
  async publish(input: Resource, token: string): Promise<Receipt> {
    const resource = parseResource(input);
    const { value } = await this.read(`publish/items/${resource.id}.json`, false, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: canonical(resource),
    });
    const r = value as Receipt | null;
    if (!r || r.id !== resource.id || r.revision !== resource.revision || !['stored', 'unchanged'].includes(r.outcome) ||
        !Number.isSafeInteger(r.current_revision) || r.current_revision < resource.revision ||
        !['published', 'withdrawn'].includes(r.current_status) ||
        (r.current_revision === resource.revision && r.current_status !== resource.status)) throw new Error('Invalid AIG sync receipt');
    return { id: r.id, revision: r.revision, outcome: r.outcome, current_revision: r.current_revision, current_status: r.current_status };
  }
}
