import { AigError, canonical, MAX_FEED_ITEMS, parseResource, receipt, transition } from '../core/resource.ts';
import type { Resource, Source } from '../core/resource.ts';

function decode(payload: string): Resource {
  try { return parseResource(JSON.parse(payload)); }
  catch { throw new AigError(502, 'invalid_stored_resource'); }
}
export class D1Source implements Source {
  constructor(private db: D1Database) {}
  async get(id: string): Promise<Resource | null> {
    const row = await this.db.prepare('SELECT payload FROM aig_items WHERE id = ?').bind(id).first<{ payload: string }>();
    return row ? decode(row.payload) : null;
  }
  async list(): Promise<Resource[]> {
    const rows = await this.db.prepare("SELECT payload FROM aig_items WHERE status = 'published' ORDER BY updated_at DESC, id LIMIT ?")
      .bind(MAX_FEED_ITEMS + 1).all<{ payload: string }>();
    if (!rows.success) throw new AigError(503, 'storage_unavailable');
    return rows.results.map(row => decode(row.payload));
  }
  async save(resource: Resource) {
    const payload = canonical(resource);
    const previous = await this.get(resource.id);
    const historical = await this.db.prepare('SELECT payload FROM aig_revisions WHERE id = ? AND revision = ?')
      .bind(resource.id, resource.revision).first<{ payload: string }>();
    if (historical) {
      if (historical.payload !== payload) throw new AigError(409, 'revision_conflict');
      if (!previous) throw new AigError(503, 'storage_inconsistent');
      return receipt(resource, previous, 'unchanged');
    }
    transition(previous, resource);
    const r = resource;
    // Conditional writes and final reads share a transaction; accepted revisions are immutable.
    const result = await this.db.batch<{ payload: string }>([
      this.db.prepare(`INSERT INTO aig_revisions (id, revision, payload)
        SELECT ?, ?, ? WHERE
        (? = 1 AND NOT EXISTS (SELECT 1 FROM aig_items WHERE id = ?)) OR
        EXISTS (SELECT 1 FROM aig_items WHERE id = ? AND revision = ? AND publisher_id = ?)
        ON CONFLICT(id, revision) DO NOTHING`)
        .bind(r.id, r.revision, payload, r.revision, r.id, r.id, r.revision - 1, r.publisher.id),
      this.db.prepare(`INSERT INTO aig_items (id, publisher_id, revision, status, updated_at, payload)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM aig_revisions WHERE id = ? AND revision = ? AND payload = ?)
        ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, status = excluded.status,
          updated_at = excluded.updated_at, payload = excluded.payload
        WHERE aig_items.revision = excluded.revision - 1 AND aig_items.publisher_id = excluded.publisher_id`)
        .bind(r.id, r.publisher.id, r.revision, r.status, r.updated_at, payload, r.id, r.revision, payload),
      this.db.prepare('SELECT payload FROM aig_revisions WHERE id = ? AND revision = ?').bind(r.id, r.revision),
      this.db.prepare('SELECT payload FROM aig_items WHERE id = ?').bind(r.id),
    ]);
    if (result.some(entry => !entry.success)) throw new AigError(503, 'storage_unavailable');
    if (result[2]!.results[0]?.payload !== payload) throw new AigError(409, 'revision_conflict');
    const current = result[3]!.results[0];
    if (!current) throw new AigError(503, 'storage_inconsistent');
    return receipt(r, decode(current.payload), result[0]!.meta.changes > 0 ? 'stored' : 'unchanged');
  }
}
