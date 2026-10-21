// Environment probe only; this is not the AIG gateway or hosting implementation.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path !== '/__local/health') {
      return Response.json({ error: 'not_found', scope: 'environment-only' }, { status: 404 });
    }
    if (request.method !== 'GET') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET' } });
    }
    try {
      const row = await env.DB.prepare('SELECT body FROM aig_environment_probe WHERE id = ?')
        .bind('synthetic-probe').first<{ body: string }>();
      if (!row) return Response.json({ error: 'local_database_not_initialized' }, { status: 503 });
      return Response.json({
        project: 'AIG',
        scope: 'environment-only',
        synthetic: true,
        database: 'local-d1',
        content_text: row.body,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ error: 'local_database_unavailable' }, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
