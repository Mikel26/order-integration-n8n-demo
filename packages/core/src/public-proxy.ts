export interface ProxyInput {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body?: string;
}
export interface ProxyReply {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}
const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const operationRoute = new RegExp(`^operations/${uuid}$`);
function failure(status: number, code: string, message: string): ProxyReply {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify({ error: { code, message } }),
  };
}
/** Only the public API is reachable. The destination is server configuration, never user input. */
export async function forwardPublicApi(
  input: ProxyInput,
  backend: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<ProxyReply> {
  const methods: Record<string, string[]> = {
    'demo-sessions': ['POST'],
    'demo-sessions/reset': ['POST'],
    stock: ['GET'],
    orders: ['GET', 'POST'],
    operations: ['GET'],
    health: ['GET'],
  };
  const allowed = operationRoute.test(input.path)
    ? ['GET']
    : Object.hasOwn(methods, input.path)
      ? methods[input.path]
      : undefined;
  if (!allowed) return failure(404, 'NOT_FOUND', 'Recurso no encontrado');
  if (!allowed.includes(input.method))
    return failure(405, 'METHOD_NOT_ALLOWED', 'Método no permitido');
  if (!backend)
    return failure(
      503,
      'DEMO_OFFLINE',
      'La demo en vivo está en preparación. Puedes consultar el video de respaldo.',
    );
  let origin: URL;
  try {
    origin = new URL(backend);
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      throw new Error();
  } catch {
    return failure(503, 'DEMO_CONFIG_REQUIRED', 'La conexión de la demo aún no está configurada.');
  }
  if (input.body && Buffer.byteLength(input.body) > 8192)
    return failure(413, 'BODY_TOO_LARGE', 'El pedido supera el tamaño permitido');
  const headers = new Headers({ accept: 'application/json' });
  for (const name of ['cookie', 'origin', 'idempotency-key', 'content-type']) {
    const value = input.headers[name];
    if (value) headers.set(name, value);
  }
  const target = new URL(input.path === 'health' ? '/health' : `/api/${input.path}`, origin);
  for (const [key, value] of input.query)
    if (key !== 'path') target.searchParams.append(key, value);
  try {
    const response = await fetcher(target, {
      method: input.method,
      headers,
      body: input.method === 'GET' ? undefined : input.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(9000),
    });
    if (response.status >= 300 && response.status < 400)
      return failure(502, 'BACKEND_UNAVAILABLE', 'La conexión con la demo no está disponible.');
    if (!response.headers.get('content-type')?.includes('application/json'))
      return failure(502, 'BACKEND_UNAVAILABLE', 'La conexión con la demo no está disponible.');
    const body = await response.text();
    if (Buffer.byteLength(body) > 1024 * 1024)
      return failure(
        502,
        'BACKEND_UNAVAILABLE',
        'La respuesta de la demo supera el tamaño permitido.',
      );
    const outgoing: ProxyReply['headers'] = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing['set-cookie'] = cookies;
    const retry = response.headers.get('retry-after');
    if (retry && /^\d+$/.test(retry)) outgoing['retry-after'] = retry;
    const location = response.headers.get('location');
    if (location?.startsWith('/api/')) outgoing.location = location;
    return { status: response.status, headers: outgoing, body };
  } catch {
    return failure(
      503,
      'BACKEND_UNAVAILABLE',
      'La demo en vivo está temporalmente fuera de línea. Puedes consultar el video de respaldo.',
    );
  }
}
