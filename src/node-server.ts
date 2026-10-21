import { createServer } from 'node:http';
import { FileSource } from './adapters/file.ts';
import { AigError } from './core/resource.ts';
import { failure, readGateway } from './core/http.ts';
import type { ContentMode } from './core/content-mode.ts';

export function fileServer(directory: string, mode: ContentMode = 'synthetic') {
  const source = new FileSource(directory);
  let count = 0;
  let reset = Date.now() + 60000;
  return createServer(async (incoming, outgoing) => {
    try {
      if (Date.now() >= reset) { count = 0; reset = Date.now() + 60000; }
      if (++count > 120) throw new AigError(429, 'rate_limited');
      const address = outgoing.socket?.localPort;
      const request = new Request(`http://127.0.0.1:${address}${incoming.url}`, { method: incoming.method });
      const response = await readGateway(request, source, mode);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch (error) {
      const response = failure(error);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    }
  });
}
