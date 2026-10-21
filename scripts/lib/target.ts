import { readFile } from 'node:fs/promises';
import { baseURL, loopback } from '../../src/core/base-url.ts';
import { publisherCredentials } from '../../src/core/publishers.ts';
import type { Credential } from '../../src/core/publishers.ts';

export async function targetURL(value: string | undefined, targetPath?: string): Promise<URL> {
  let allowed: URL | undefined;
  if (targetPath) {
    let origin: unknown;
    try { origin = JSON.parse(await readFile(targetPath, 'utf8')).origin; }
    catch { throw new Error('Cannot read validation target'); }
    if (typeof origin !== 'string') throw new Error('Validation target requires one HTTPS origin');
    allowed = baseURL(origin);
    if (allowed.protocol !== 'https:') throw new Error('Validation target requires HTTPS');
  }
  const url = baseURL(value ?? allowed?.href ?? 'http://127.0.0.1:8787/');
  if (allowed ? url.origin !== allowed.origin : !loopback(url.hostname)) {
    throw new Error(allowed ? 'Gateway does not match the configured validation origin' : 'Local loopback URL required; use --target for controlled HTTPS validation');
  }
  return url;
}

export type { Credential } from '../../src/core/publishers.ts';
export async function readCredentials(path: string): Promise<Credential[]> {
  try {
    return publisherCredentials(JSON.parse(await readFile(path, 'utf8')));
  } catch { throw new Error('Invalid or unavailable publisher credentials'); }
}
