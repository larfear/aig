import { resource as validate } from '../../.local/validators.mjs';

export interface Resource {
  schema_version: 'aig-resource/0.1-draft';
  id: string;
  title?: string;
  publisher: { id: string; name: string };
  source: { system: string; record_id: string; public_url?: string };
  revision: number;
  status: 'published' | 'withdrawn';
  published_at: string;
  updated_at: string;
  synthetic: boolean;
  withdrawal_reason?: string;
  representations: { media_type: string; derivation: 'original' | 'human_summary' | 'machine_summary' | 'transcript'; content_text?: string; url?: string }[];
  extensions?: Record<string, unknown>;
}

export const MAX_RESOURCE_BYTES = 256 * 1024;
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_FEED_ITEMS = 100;
export const ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
export class AigError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function parseResource(value: unknown): Resource {
  if (!validate(value)) throw new AigError(422, 'invalid_resource');
  const r = value as Resource;
  if (!Number.isSafeInteger(r.revision) || Date.parse(r.updated_at) < Date.parse(r.published_at)) {
    throw new AigError(422, 'invalid_revision_or_time');
  }
  if (new TextEncoder().encode(canonical(r)).byteLength > MAX_RESOURCE_BYTES) throw new AigError(413, 'resource_too_large');
  if (r.status === 'published' && !primaryText(r)) throw new AigError(422, 'original_inline_text_required');
  return r;
}
export function primaryText(r: Resource): string | undefined {
  return r.representations.find(rep => rep.derivation === 'original' &&
    ['text/plain', 'text/markdown'].includes(rep.media_type) && rep.content_text !== undefined)?.content_text;
}
export function transition(previous: Resource | null, next: Resource): void {
  if (!previous) {
    if (next.revision !== 1 || next.status !== 'published') throw new AigError(409, 'first_revision_required');
    return;
  }
  if (previous.publisher.id !== next.publisher.id || previous.source.system !== next.source.system ||
      previous.source.record_id !== next.source.record_id || previous.published_at !== next.published_at ||
      previous.synthetic !== next.synthetic) throw new AigError(409, 'resource_identity_conflict');
  if (next.revision !== previous.revision + 1 || Date.parse(next.updated_at) < Date.parse(previous.updated_at)) {
    throw new AigError(409, 'revision_conflict');
  }
}
export function tombstone(r: Resource): Resource {
  return { schema_version: r.schema_version, id: r.id, publisher: r.publisher, source: r.source,
    revision: r.revision, status: 'withdrawn', published_at: r.published_at, updated_at: r.updated_at,
    synthetic: r.synthetic, withdrawal_reason: r.withdrawal_reason!, representations: [] };
}
export interface Source {
  get(id: string): Promise<Resource | null>;
  list(): Promise<Resource[]>;
}
export interface Receipt {
  id: string; revision: number; outcome: 'stored' | 'unchanged';
  current_revision: number; current_status: Resource['status'];
}
export function receipt(r: Resource, current: Resource, outcome: Receipt['outcome']): Receipt {
  return { id: r.id, revision: r.revision, outcome, current_revision: current.revision, current_status: current.status };
}
