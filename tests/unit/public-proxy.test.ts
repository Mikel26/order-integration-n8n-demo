import { describe, it, expect, vi } from 'vitest';
import { forwardPublicApi, type ProxyInput } from '../../packages/core/src/public-proxy.js';
const input: ProxyInput = {
  method: 'POST',
  path: 'orders',
  query: new URLSearchParams('path=orders'),
  headers: {
    origin: 'https://orderflow.vercel.app',
    cookie: 'demo_session=opaque',
    'idempotency-key': 'unique',
    'content-type': 'application/json',
  },
  body: '{"clientOrderId":"A","items":[]}',
};
const backend = 'https://api.example.invalid';
describe('Proxy público de Vercel', () => {
  it('explica que la demo está desconectada sin generar resultados ficticios', async () => {
    const fetcher = vi.fn();
    const result = await forwardPublicApi(input, undefined, fetcher);
    expect(result.status).toBe(503);
    expect(JSON.parse(result.body).error.code).toBe('DEMO_OFFLINE');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'internal/operations',
    '__proto__',
    'toString',
    '../internal',
    'https://evil.example/',
    'orders?target=bad',
    'orders/../../internal',
  ])('rechaza rutas fuera de la API pública: %s', async (path) => {
    const fetcher = vi.fn();
    expect((await forwardPublicApi({ ...input, path }, backend, fetcher)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'http://api.example.invalid',
    'https://user:secret@api.example.invalid',
    'https://api.example.invalid/internal',
  ])('exige origen HTTPS sin credenciales ni ruta: %s', async (url) => {
    expect((await forwardPublicApi(input, url)).status).toBe(503);
  });
  it('conserva cookie, origen, clave y recibo de admisión sin reenviar cabeceras arbitrarias', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"status":"ACCEPTED"}', {
        status: 202,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'demo_session=new; HttpOnly; Secure; SameSite=Lax',
          location: '/api/operations/123',
        },
      }),
    );
    const result = await forwardPublicApi(
      { ...input, headers: { ...input.headers, authorization: 'do-not-forward' } },
      backend,
      fetcher,
    );
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(backend + '/api/orders');
    const headers = new Headers(options!.headers);
    expect(headers.get('cookie')).toBe('demo_session=opaque');
    expect(headers.get('origin')).toBe(input.headers.origin);
    expect(headers.get('idempotency-key')).toBe('unique');
    expect(headers.has('authorization')).toBe(false);
    expect(options!.redirect).toBe('manual');
    expect(result.status).toBe(202);
    expect(result.headers['set-cookie']).toEqual([
      'demo_session=new; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(result.headers.location).toBe('/api/operations/123');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('mantiene parámetros de paginación y Retry-After', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"error":{"code":"RATE_LIMIT"}}', {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '60' },
      }),
    );
    const result = await forwardPublicApi(
      {
        ...input,
        method: 'GET',
        path: 'orders',
        query: new URLSearchParams('path=orders&limit=20&cursor=abc'),
      },
      backend,
      fetcher,
    );
    expect(String(fetcher.mock.calls[0]![0])).toBe(backend + '/api/orders?limit=20&cursor=abc');
    expect(fetcher.mock.calls[0]![1]!.body).toBeUndefined();
    expect(result.status).toBe(429);
    expect(result.headers['retry-after']).toBe('60');
  });
  it('no sigue redirecciones ni publica respuestas HTML del backend', async () => {
    for (const response of [
      new Response('', { status: 302, headers: { location: 'https://evil.example' } }),
      new Response('<h1>Error</h1>', { headers: { 'content-type': 'text/html' } }),
    ]) {
      const result = await forwardPublicApi(
        input,
        backend,
        vi.fn<typeof fetch>().mockResolvedValue(response),
      );
      expect(result.status).toBe(502);
      expect(result.body).not.toContain('evil');
    }
  });
  it('convierte caídas de red en un estado explícito y limita cuerpos', async () => {
    expect(
      (
        await forwardPublicApi(
          input,
          backend,
          vi.fn<typeof fetch>().mockRejectedValue(new Error('private details')),
        )
      ).status,
    ).toBe(503);
    expect((await forwardPublicApi({ ...input, body: 'x'.repeat(8193) }, backend)).status).toBe(
      413,
    );
    expect((await forwardPublicApi({ ...input, method: 'DELETE' }, backend)).status).toBe(405);
  });
});
