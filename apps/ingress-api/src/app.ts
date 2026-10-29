import cookie from '@fastify/cookie';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { orderSchema, isTerminal, type OrderInput } from '../../../packages/contracts/src/index.js';
import { Domain } from '../../../packages/core/src/domain.js';
import { AppError, missing } from '../../../packages/core/src/db.js';
import {
  server,
  authorize,
  idParams,
  uuidSchema,
  tokenBody,
} from '../../../packages/core/src/http.js';
const listSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'string', pattern: '^(?:[1-9]|[1-4][0-9]|50)$' },
    cursor: { type: 'string', maxLength: 256 },
  },
};
function page(query: unknown) {
  const q = query as { limit?: string; cursor?: string };
  let cursor: null | { at: string; id: string } = null;
  if (q.cursor)
    try {
      cursor = JSON.parse(Buffer.from(q.cursor, 'base64url').toString());
      if (!cursor || !Number.isFinite(Date.parse(cursor.at)) || !/^[a-f0-9-]{36}$/.test(cursor.id))
        throw 0;
    } catch {
      throw new AppError(422, 'INVALID_CURSOR', 'Cursor inválido');
    }
  return { limit: Number(q.limit ?? 20), cursor };
}
export async function publicApp(domain: Domain, logger = true) {
  const app = server(logger, domain.cfg.trustedProxy);
  await app.register(cookie);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      req.headers.origin !== domain.cfg.publicOrigin
    )
      throw new AppError(403, 'INVALID_ORIGIN', 'Origen no autorizado');
  });
  const identity = async (req: FastifyRequest) => {
    const ctx = await domain.session(req.cookies.demo_session);
    if (req.method === 'GET') await domain.rateRead(ctx.visitor.id);
    return ctx;
  };
  app.get('/health', async () => {
    await domain.db.pool.query('SELECT 1');
    return { status: 'ok' };
  });
  for (const reset of [false, true])
    app.post(reset ? '/api/demo-sessions/reset' : '/api/demo-sessions', async (req, reply) => {
      const result = await domain.createSession(req.ip, req.cookies.demo_session, reset);
      reply.setCookie('demo_session', result.token, {
        httpOnly: true,
        secure: domain.cfg.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 172800,
      });
      return reply.code(result.created ? 201 : 200).send({
        sessionId: result.session.id,
        expiresAt: result.session.expires_at,
        previousSessionId: result.previousSessionId,
      });
    });
  app.post<{ Body: OrderInput }>(
    '/api/orders',
    {
      schema: {
        body: orderSchema,
        headers: {
          type: 'object',
          required: ['idempotency-key'],
          properties: { 'idempotency-key': uuidSchema },
        },
      },
    },
    async (req, reply) => {
      const ctx = await identity(req);
      const { op, replayed } = await domain.admit(
        ctx.session.id,
        req.ip,
        req.headers['idempotency-key'] as string,
        req.body,
      );
      const statusUrl = `/api/operations/${op.id}`;
      return reply
        .code(replayed && isTerminal(op.status) ? 200 : 202)
        .header('Location', statusUrl)
        .send({ operationId: op.id, status: op.status, statusUrl, replayed });
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/operations/:id',
    { schema: { params: idParams } },
    async (req) => {
      const ctx = await identity(req);
      return domain.operation(req.params.id, ctx.visitor.id);
    },
  );
  app.get('/api/stock', async (req) => {
    const ctx = await identity(req);
    const items = (
      await domain.db.pool.query(
        'SELECT s.sku,p.name,s.available FROM session_stock s JOIN products p USING(sku) WHERE s.session_id=$1 ORDER BY sku',
        [ctx.session.id],
      )
    ).rows;
    return { items, updatedAt: new Date().toISOString() };
  });
  for (const kind of ['orders', 'operations'] as const)
    app.get(`/api/${kind}`, { schema: { querystring: listSchema } }, async (req) => {
      const ctx = await identity(req),
        { limit, cursor } = page(req.query);
      const values = [ctx.session.id, cursor?.at ?? null, cursor?.id ?? randomUUID(), limit + 1];
      const rows = (
        await domain.db.pool.query(
          `SELECT * FROM ${kind} WHERE session_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT $4`,
          values,
        )
      ).rows;
      const selected = rows.slice(0, limit);
      const last = selected.at(-1);
      const nextCursor =
        rows.length > limit
          ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString('base64url')
          : null;
      const items = await Promise.all(
        selected.map(async (row) =>
          kind === 'operations'
            ? {
                operationId: row.id,
                clientOrderId: row.client_order_id,
                status: row.status,
                updatedAt: row.updated_at,
              }
            : {
                orderId: row.id,
                clientOrderId: row.client_order_id,
                createdAt: row.created_at,
                items: (
                  await domain.db.pool.query(
                    'SELECT sku,quantity FROM order_items WHERE order_id=$1 ORDER BY sku',
                    [row.id],
                  )
                ).rows,
              },
        ),
      );
      return { items, nextCursor };
    });
  return app;
}
export async function internalApp(domain: Domain, logger = true) {
  const app = server(logger);
  app.addHook('onRequest', async (req) =>
    authorize(req.headers['x-internal-secret'], domain.cfg.internalSecret),
  );
  app.get('/health', async () => ({ status: 'ok' }));
  app.post<{ Params: { id: string }; Body: { attemptToken: string; executionId: string } }>(
    '/internal/operations/:id/claim',
    {
      schema: {
        params: idParams,
        body: {
          ...tokenBody,
          required: ['attemptToken', 'executionId'],
          properties: {
            ...tokenBody.properties,
            executionId: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
      },
    },
    (req) => domain.claim(req.params.id, req.body.attemptToken, req.body.executionId),
  );
  app.post<{ Params: { id: string }; Body: { attemptToken: string; receiptId: string } }>(
    '/internal/operations/:id/finalize',
    {
      schema: {
        params: idParams,
        body: {
          ...tokenBody,
          required: ['attemptToken', 'receiptId'],
          properties: { ...tokenBody.properties, receiptId: uuidSchema },
        },
      },
    },
    (req) => domain.finalize(req.params.id, req.body.attemptToken, req.body.receiptId),
  );
  app.post<{
    Params: { id: string };
    Body: { attemptToken: string; code: string; retryable: boolean; executionId?: string };
  }>(
    '/internal/operations/:id/report-failure',
    {
      schema: {
        params: idParams,
        body: {
          ...tokenBody,
          required: ['attemptToken', 'retryable', 'code'],
          properties: {
            ...tokenBody.properties,
            code: { type: 'string', maxLength: 80 },
            retryable: { type: 'boolean' },
            executionId: { type: 'string', maxLength: 128 },
          },
        },
      },
    },
    (req) => domain.reportFailure(req.params.id, req.body.attemptToken, req.body.retryable),
  );
  app.get<{ Params: { executionId: string } }>(
    '/internal/operations/by-execution/:executionId',
    async (req) => {
      const row = (
        await domain.db.pool.query(
          'SELECT operation_id,attempt_token FROM execution_attempts WHERE execution_id=$1',
          [req.params.executionId],
        )
      ).rows[0];
      if (!row) throw missing();
      return { operationId: row.operation_id, attemptToken: row.attempt_token };
    },
  );
  return app;
}
