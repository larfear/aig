import { AigError } from './resource.ts';
import type { Resource } from './resource.ts';

export type ContentMode = 'synthetic' | 'public';

export function contentMode(value: unknown = 'synthetic'): ContentMode {
  if (value === 'synthetic' || value === 'public') return value;
  throw new AigError(503, 'invalid_content_mode');
}

export function allowContent(resource: Resource, mode: ContentMode): void {
  if (contentMode(mode) === 'synthetic' && !resource.synthetic) throw new AigError(422, 'synthetic_only');
}
