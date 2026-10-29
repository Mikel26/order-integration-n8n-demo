import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Database } from '../../packages/core/src/db.js';
import { Domain } from '../../packages/core/src/domain.js';
import { configFromEnv } from '../../packages/core/src/config.js';
import { publicApp, internalApp } from '../../apps/ingress-api/src/app.js';
import { erpApp } from '../../apps/mock-erp/src/app.js';
import type { OrderInput } from '../../packages/contracts/src/index.js';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL debe apuntar a una base terminada en _test');
const db = new Database(url),
  cfg = { ...configFromEnv(), databaseUrl: url },
  domain = new Domain(db, cfg);
const order = (id = 'WEB-1', qty = 2): OrderInput => ({
  clientOrderId: id,
  items: [{ sku: 'DEMO-001', quantity: qty }],
});
async function session(ip = '127.0.0.1') {
  return domain.createSession(ip);
}
async function admit(s: string, input = order(), key = randomUUID()) {
  return (await domain.admit(s, '127.0.0.1', key, input)).op;
}
async function run(id: string, input: OrderInput) {
  const attempt = await domain.reserve(id);
  expect(attempt).toBeTruthy();
  await domain.claim(id, attempt!.attemptToken, randomUUID());
  const result = await domain.processErp(id, attempt!.attemptToken, input);
  await domain.finalize(id, attempt!.attemptToken, result.receipt.receiptId);
  return result.receipt;
}
async function available(s: string) {
  return Number(
    (
      await db.pool.query(
        "SELECT available FROM session_stock WHERE session_id=$1 AND sku='DEMO-001'",
        [s],
      )
    ).rows[0].available,
  );
}
beforeAll(async () => {
  const exists = (await db.pool.query("SELECT to_regclass('public.operations') AS name")).rows[0]
    .name;
  if (!exists) await db.pool.query(await readFile('database/migrations/001_initial.sql', 'utf8'));
});
beforeEach(async () => {
  await db.pool.query('TRUNCATE visitors,demo_sessions,rate_buckets CASCADE');
});
afterAll(() => db.close());
describe('PostgreSQL real: integridad del flujo', () => {
  it('confirma stock, pedido y recibo dentro de una transacción', async () => {
    const s = await session(),
      op = await admit(s.session.id);
    const r = await run(op.id, order());
    expect(r.outcome).toBe('SUCCEEDED');
    expect(await available(s.session.id)).toBe(3);
    expect(
      (await domain.operation(op.id, s.session.visitor_id)).events.map((e) => e.status),
    ).toEqual(['ACCEPTED', 'PROCESSING', 'SUCCEEDED']);
  });
  it('serializa 10 envíos con la misma clave en una operación', async () => {
    const s = await session(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => domain.admit(s.session.id, 'ip', key, order())),
    );
    expect(new Set(results.map((r) => r.op.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    await expect(domain.admit(s.session.id, 'ip', key, order('WEB-1', 3))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });
  it('deduplica dos pedidos simultáneos con claves distintas', async () => {
    const s = await session();
    const a = await admit(s.session.id),
      b = await admit(s.session.id);
    const outcomes = await Promise.all([run(a.id, order()), run(b.id, order())]);
    expect(outcomes.map((r) => r.outcome).sort()).toEqual(['DUPLICATE', 'SUCCEEDED']);
    expect(await available(s.session.id)).toBe(3);
    expect(Number((await db.pool.query('SELECT count(*) FROM orders')).rows[0].count)).toBe(1);
  });
  it('evita sobreventa de dos pedidos de cuatro teclados', async () => {
    const s = await session();
    const a = await admit(s.session.id, order('A', 4)),
      b = await admit(s.session.id, order('B', 4));
    const results = await Promise.all([run(a.id, order('A', 4)), run(b.id, order('B', 4))]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['REJECTED', 'SUCCEEDED']);
    expect(await available(s.session.id)).toBe(1);
  });
  it('rechaza todas las líneas sin descuentos parciales', async () => {
    const s = await session(),
      input = {
        clientOrderId: 'A',
        items: [
          { sku: 'DEMO-001', quantity: 2 },
          { sku: 'DEMO-003', quantity: 3 },
        ],
      };
    const op = await admit(s.session.id, input);
    expect((await run(op.id, input)).code).toBe('INSUFFICIENT_STOCK');
    expect(await available(s.session.id)).toBe(5);
  });
  it('distingue contenido conflictivo y duplicado de un rechazo', async () => {
    const s = await session();
    const a = await admit(s.session.id, order('A', 6));
    await run(a.id, order('A', 6));
    const b = await admit(s.session.id, order('A', 6));
    const duplicate = await run(b.id, order('A', 6));
    expect(duplicate.outcome).toBe('DUPLICATE');
    expect(duplicate.originalStatus).toBe('REJECTED');
    const c = await admit(s.session.id, order('A', 1));
    expect((await run(c.id, order('A', 1))).code).toBe('ORDER_ID_CONFLICT');
    expect(await available(s.session.id)).toBe(5);
  });
  it('recupera el resultado si se perdió la respuesta después del COMMIT', async () => {
    const s = await session(),
      op = await admit(s.session.id);
    const a = (await domain.reserve(op.id))!;
    await domain.claim(op.id, a.attemptToken, 'lost-response');
    await domain.processErp(op.id, a.attemptToken, order());
    expect(await domain.reserve(op.id)).toBeNull();
    expect((await domain.operation(op.id, s.session.visitor_id)).status).toBe('SUCCEEDED');
    expect(await available(s.session.id)).toBe(3);
  });
  it('revoca una ejecución tardía sin efectos después del fallo terminal', async () => {
    const s = await session(),
      op = await admit(s.session.id);
    const a = (await domain.reserve(op.id))!;
    await domain.claim(op.id, a.attemptToken, 'late');
    await domain.reportFailure(op.id, a.attemptToken, false);
    await expect(domain.processErp(op.id, a.attemptToken, order())).rejects.toMatchObject({
      code: 'STALE_ATTEMPT',
    });
    expect(await available(s.session.id)).toBe(5);
  });
  it('serializa el cierre técnico con un ERP concurrente', async () => {
    const s = await session(),
      op = await admit(s.session.id);
    const a = (await domain.reserve(op.id))!;
    await domain.claim(op.id, a.attemptToken, 'race');
    await Promise.allSettled([
      domain.processErp(op.id, a.attemptToken, order()),
      domain.reportFailure(op.id, a.attemptToken, false),
    ]);
    const state = await domain.operation(op.id, s.session.visitor_id);
    expect(['SUCCEEDED', 'FAILED_TECHNICAL']).toContain(state.status);
    expect(await available(s.session.id)).toBe(state.status === 'SUCCEEDED' ? 3 : 5);
  });
  it('limita los intentos y no reactiva operaciones terminales', async () => {
    const s = await session(),
      op = await admit(s.session.id);
    for (let i = 0; i < 3; i++) {
      const a = (await domain.reserve(op.id))!;
      await domain.reportFailure(op.id, a.attemptToken, true);
      await db.pool.query('UPDATE operations SET next_attempt_at=clock_timestamp() WHERE id=$1', [
        op.id,
      ]);
    }
    expect(await domain.reserve(op.id)).toBeNull();
    const state = await domain.operation(op.id, s.session.visitor_id);
    expect(state.status).toBe('FAILED_TECHNICAL');
    expect(state.attemptCount).toBe(3);
  });
  it('aísla visitantes y conserva el resultado anterior al reiniciar', async () => {
    const a = await session('a'),
      b = await session('b');
    const op = await admit(a.session.id);
    const reset = await domain.createSession('a', a.token, true);
    await run(op.id, order());
    expect(await available(a.session.id)).toBe(3);
    expect(await available(reset.session.id)).toBe(5);
    expect(await available(b.session.id)).toBe(5);
    expect((await domain.operation(op.id, a.session.visitor_id)).status).toBe('SUCCEEDED');
    await expect(domain.operation(op.id, b.session.visitor_id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
  it('expira sin borrar operaciones activas y purga después de resolverlas', async () => {
    const s = await session(),
      op = await admit(s.session.id);
    await db.pool.query(
      "UPDATE demo_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [s.session.id],
    );
    await domain.cleanup();
    expect(
      (await db.pool.query('SELECT status FROM demo_sessions WHERE id=$1', [s.session.id])).rows[0]
        .status,
    ).toBe('CLOSING');
    await run(op.id, order());
    await domain.cleanup();
    await db.pool.query(
      "UPDATE demo_sessions SET purge_after=clock_timestamp()-interval '1 second' WHERE id=$1",
      [s.session.id],
    );
    await domain.cleanup();
    expect((await db.pool.query('SELECT * FROM demo_sessions')).rowCount).toBe(0);
  });

  it('revierte descuentos y pedido si falla una inserción dentro de la transacción', async () => {
    const s = await session();
    const input = {
      clientOrderId: 'ROLLBACK',
      items: [
        { sku: 'DEMO-001', quantity: 2 },
        { sku: 'DEMO-002', quantity: 1 },
      ],
    };
    const op = await admit(s.session.id, input);
    const a = (await domain.reserve(op.id))!;
    await domain.claim(op.id, a.attemptToken, 'rollback-test');
    await db.pool.query(
      `CREATE FUNCTION fail_demo_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sku='DEMO-002' THEN RAISE EXCEPTION 'injected write failure'; END IF; RETURN NEW; END $$`,
    );
    await db.pool.query(
      'CREATE TRIGGER fail_demo_line BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_demo_line()',
    );
    try {
      await expect(domain.processErp(op.id, a.attemptToken, input)).rejects.toThrow(
        'injected write failure',
      );
      expect(await available(s.session.id)).toBe(5);
      expect(Number((await db.pool.query('SELECT count(*) FROM orders')).rows[0].count)).toBe(0);
      expect(Number((await db.pool.query('SELECT count(*) FROM erp_receipts')).rows[0].count)).toBe(
        0,
      );
    } finally {
      await db.pool.query('DROP TRIGGER fail_demo_line ON order_items');
      await db.pool.query('DROP FUNCTION fail_demo_line()');
    }
  });
});
describe('API pública e interna', () => {
  it('no permite eludir la cuota falsificando X-Forwarded-For sin proxy confiable', async () => {
    const app = await publicApp(domain, false);
    try {
      for (let i = 0; i < 6; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/demo-sessions',
          headers: { origin: cfg.publicOrigin, 'x-forwarded-for': `192.0.2.${i + 1}` },
        });
        expect(response.statusCode).toBe(i < 5 ? 201 : 429);
      }
    } finally {
      await app.close();
    }
  });

  it('valida origen, sesión, cuerpos, secretos y acceso entre sesiones', async () => {
    const app = await publicApp(domain, false),
      internal = await internalApp(domain, false),
      erp = await erpApp(domain, false);
    try {
      expect((await app.inject({ method: 'POST', url: '/api/demo-sessions' })).statusCode).toBe(
        403,
      );
      expect((await app.inject('/api/stock')).statusCode).toBe(401);
      const created = await app.inject({
        method: 'POST',
        url: '/api/demo-sessions',
        headers: { origin: cfg.publicOrigin },
      });
      expect(created.statusCode).toBe(201);
      const cookie = created.cookies[0]!;
      const headers = {
        origin: cfg.publicOrigin,
        cookie: `demo_session=${cookie.value}`,
        'idempotency-key': randomUUID(),
      };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/orders',
            headers,
            payload: { ...order(), extra: 'bad' },
          })
        ).statusCode,
      ).toBe(422);
      expect(
        (await app.inject({ method: 'POST', url: '/api/orders', headers, payload: order('A', 0) }))
          .statusCode,
      ).toBe(422);
      expect(
        (await app.inject({ method: 'POST', url: '/api/orders', headers, payload: order() }))
          .statusCode,
      ).toBe(202);
      expect((await app.inject({ url: '/api/orders?cursor=invalid', headers })).statusCode).toBe(
        422,
      );
      expect((await internal.inject('/health')).statusCode).toBe(401);
      expect((await erp.inject('/health')).statusCode).toBe(401);
    } finally {
      await Promise.all([app.close(), internal.close(), erp.close()]);
    }
  });
});
