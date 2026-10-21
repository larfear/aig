import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AigError, canonical, ID, MAX_FEED_ITEMS, MAX_RESOURCE_BYTES, parseResource, receipt, transition } from '../core/resource.ts';
import type { Resource, Source } from '../core/resource.ts';

export class FileSource implements Source {
  readonly directory: string;
  constructor(directory: string) { this.directory = directory; }
  async get(id: string): Promise<Resource | null> {
    if (!ID.test(id)) throw new AigError(400, 'invalid_id');
    let handle;
    try {
      // Do not follow symlinks out of the explicitly selected public directory.
      const { constants } = await import('node:fs');
      handle = await open(join(this.directory, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) throw new AigError(502, 'invalid_source');
      const r = parseResource(JSON.parse(await handle.readFile('utf8')));
      if (r.id !== id) throw new AigError(502, 'invalid_source');
      return r;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try { await readdir(this.directory); } catch { throw new AigError(503, 'source_unavailable'); }
        return null;
      }
      if (error instanceof AigError && error.status >= 500) throw error;
      throw new AigError(502, 'invalid_source');
    } finally { await handle?.close(); }
  }
  async list(): Promise<Resource[]> {
    const names = (await readdir(this.directory)).filter(n => n.endsWith('.json'));
    if (names.length > MAX_FEED_ITEMS) throw new AigError(503, 'feed_capacity_exceeded');
    const result: Resource[] = [];
    for (const name of names.sort()) {
      const id = name.slice(0, -5);
      if (!ID.test(id)) throw new AigError(502, 'invalid_source');
      const r = await this.get(id);
      if (!r) throw new AigError(503, 'source_changed_during_read');
      result.push(r);
    }
    return result;
  }
}

export async function publishFile(directory: string, value: unknown) {
  const resource = parseResource(value);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, '.publish.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new AigError(409, 'publisher_busy'); }
  const temporary = join(directory, `.${resource.id}.${crypto.randomUUID()}.tmp`);
  try {
    const previous = await new FileSource(directory).get(resource.id);
    if (previous && canonical(previous) === canonical(resource)) return receipt(resource, previous, 'unchanged');
    transition(previous, resource);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(canonical(resource)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, join(directory, `${resource.id}.json`));
    return receipt(resource, resource, 'stored');
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}
