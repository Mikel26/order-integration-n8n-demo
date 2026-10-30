import type { IncomingMessage, ServerResponse } from 'node:http';
import { forwardPublicApi } from '../packages/core/src/public-proxy.js';
type Request = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
export default async function handler(request: Request, response: ServerResponse) {
  const reject = (status: number, code: string, message: string) => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    response.end(JSON.stringify({ error: { code, message } }));
  };
  if (Number(request.headers['content-length'] ?? 0) > 8192)
    return reject(413, 'BODY_TOO_LARGE', 'El pedido supera el tamaño permitido');
  const contentType = request.headers['content-type'];
  if (contentType && !contentType.toLowerCase().startsWith('application/json'))
    return reject(415, 'UNSUPPORTED_MEDIA_TYPE', 'Se requiere JSON');
  let body: string | undefined;
  try {
    const parsed = request.body;
    if (parsed !== undefined) body = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
    else if (request.method !== 'GET' && request.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 8192)
          return reject(413, 'BODY_TOO_LARGE', 'El pedido supera el tamaño permitido');
        chunks.push(bytes);
      }
      if (size) body = Buffer.concat(chunks).toString('utf8');
    }
  } catch {
    return reject(400, 'INVALID_REQUEST', 'Solicitud no válida');
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = request.query?.path ?? url.searchParams.get('path') ?? '';
  const headers: Record<string, string | undefined> = {};
  for (const name of ['cookie', 'origin', 'content-type', 'idempotency-key']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  const reply = await forwardPublicApi(
    {
      method: request.method ?? 'GET',
      path: typeof path === 'string' ? path : '',
      query: url.searchParams,
      headers,
      body,
    },
    process.env.DEMO_BACKEND_ORIGIN,
  );
  response.statusCode = reply.status;
  for (const [key, value] of Object.entries(reply.headers)) response.setHeader(key, value);
  response.end(reply.body);
}
