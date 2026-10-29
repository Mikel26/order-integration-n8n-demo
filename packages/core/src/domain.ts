import { randomUUID, randomBytes, createHash } from 'node:crypto';
import {
  type OrderInput,
  type Result,
  type Status,
  isTerminal,
} from '../../contracts/src/index.js';
import { hashOrder, canonicalOrder } from './canonical.js';
import { type Tx, Database, AppError, missing } from './db.js';
import type { Config } from './config.js';

type Row = Record<string, any>;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const emptyResult = (code: string): Result => ({
  code,
  orderId: null,
  originalOperationId: null,
  originalStatus: null,
  details: [],
});
export class Domain {
  constructor(
    readonly db: Database,
    readonly cfg: Config,
  ) {}
  async rate(tx: Tx, key: string, max: number, windowMs = 60_000) {
    const { rows } = await tx.query(
      `INSERT INTO rate_buckets(key,hits,expires_at) VALUES($1,1,clock_timestamp()+$2*interval '1 millisecond')
   ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_buckets.expires_at<=clock_timestamp() THEN 1 ELSE rate_buckets.hits+1 END,
   expires_at=CASE WHEN rate_buckets.expires_at<=clock_timestamp() THEN excluded.expires_at ELSE rate_buckets.expires_at END RETURNING hits`,
      [key, windowMs],
    );
    if (rows[0].hits > max)
      throw new AppError(429, 'RATE_LIMIT', 'Límite de uso alcanzado; inténtalo más tarde');
  }
  async rateRead(visitorId: string) {
    await this.db.tx((tx) => this.rate(tx, `read:${visitorId}`, 60));
  }
  async visitor(token: string | undefined): Promise<Row | null> {
    if (!token || token.length > 128) return null;
    return (
      (await this.db.pool.query('SELECT * FROM visitors WHERE token_hash=$1', [hash(token)]))
        .rows[0] ?? null
    );
  }
  async session(token: string | undefined): Promise<{ visitor: Row; session: Row }> {
    const visitor = await this.visitor(token);
    if (!visitor) throw new AppError(401, 'SESSION_REQUIRED', 'Inicia una sesión de demo');
    const session = (
      await this.db.pool.query('SELECT * FROM demo_sessions WHERE id=$1', [
        visitor.current_session_id,
      ])
    ).rows[0];
    if (!session) throw new AppError(410, 'SESSION_EXPIRED', 'La sesión terminó; reinicia la demo');
    return { visitor, session };
  }
  async createSession(ip: string, token?: string, reset = false) {
    const known = await this.visitor(token);
    const newToken = known ? token! : randomBytes(32).toString('hex');
    return this.db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(27101992)');
      let visitor = known
        ? (await tx.query('SELECT * FROM visitors WHERE id=$1 FOR UPDATE', [known.id])).rows[0]
        : null;
      if (visitor && !reset) {
        const existing = (
          await tx.query('SELECT * FROM demo_sessions WHERE id=$1', [visitor.current_session_id])
        ).rows[0];
        if (existing?.status === 'ACTIVE' && new Date(existing.expires_at).getTime() > Date.now())
          return { token: newToken, session: existing, created: false, previousSessionId: null };
        throw new AppError(410, 'SESSION_EXPIRED', 'La sesión terminó; reinicia la demo');
      }
      await this.rate(tx, `sessions:${ip}`, 5, 3_600_000);
      const size = Number((await tx.query('SELECT count(*) FROM demo_sessions')).rows[0].count);
      if (size >= 100)
        throw new AppError(503, 'DEMO_CAPACITY', 'La demo está ocupada; vuelve más tarde');
      if (!visitor) {
        visitor = { id: randomUUID(), current_session_id: null };
        await tx.query('INSERT INTO visitors(id,token_hash) VALUES($1,$2)', [
          visitor.id,
          hash(newToken),
        ]);
      }
      const previousSessionId = visitor.current_session_id;
      if (previousSessionId)
        await tx.query(
          `UPDATE demo_sessions SET status='CLOSING',closed_at=clock_timestamp() WHERE id=$1 AND status='ACTIVE'`,
          [previousSessionId],
        );
      const id = randomUUID();
      const session = (
        await tx.query(
          `INSERT INTO demo_sessions(id,visitor_id,expires_at) VALUES($1,$2,clock_timestamp()+$3*interval '1 millisecond') RETURNING *`,
          [id, visitor.id, this.cfg.sessionTtlMs],
        )
      ).rows[0];
      await tx.query(
        'INSERT INTO session_stock(session_id,sku,available) SELECT $1,sku,initial_stock FROM products',
        [id],
      );
      await tx.query('UPDATE visitors SET current_session_id=$1 WHERE id=$2', [id, visitor.id]);
      return { token: newToken, session, created: true, previousSessionId };
    });
  }
  async event(tx: Tx, op: Row, status: Status, code?: string, result?: Result) {
    await tx.query(
      `UPDATE operations SET status=$2,updated_at=clock_timestamp(),result_json=COALESCE($3::jsonb,result_json) WHERE id=$1`,
      [op.id, status, result ? JSON.stringify(result) : null],
    );
    await tx.query(
      `INSERT INTO operation_events(operation_id,sequence,status,code) SELECT $1,COALESCE(max(sequence),0)+1,$2,$3 FROM operation_events WHERE operation_id=$1`,
      [op.id, status, code ?? null],
    );
    op.status = status;
  }
  async admit(sessionId: string, ip: string, key: string, input: OrderInput) {
    if (new Set(input.items.map((i) => i.sku)).size !== input.items.length)
      throw new AppError(422, 'DUPLICATE_SKU', 'Un producto solo puede aparecer una vez');
    const payload = canonicalOrder(input),
      fingerprint = hashOrder(input);
    return this.db.tx(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(27101992)');
      const session = (
        await tx.query('SELECT * FROM demo_sessions WHERE id=$1 FOR UPDATE', [sessionId])
      ).rows[0];
      if (
        !session ||
        session.status !== 'ACTIVE' ||
        new Date(session.expires_at).getTime() <= Date.now()
      )
        throw new AppError(410, 'SESSION_EXPIRED', 'Reinicia la demo para enviar otro pedido');
      const old = (
        await tx.query('SELECT * FROM operations WHERE session_id=$1 AND idempotency_key=$2', [
          sessionId,
          key,
        ])
      ).rows[0];
      if (old) {
        if (old.payload_hash !== fingerprint)
          throw new AppError(
            409,
            'IDEMPOTENCY_KEY_REUSED',
            'La clave ya fue usada con otro contenido',
          );
        return { op: old, replayed: true };
      }
      await this.rate(tx, `admit:${sessionId}`, 10);
      await this.rate(tx, `admit-ip:${ip}`, 30);
      const counts = (
        await tx.query(
          `SELECT count(*) AS total,count(*) FILTER(WHERE status IN ('ACCEPTED','PROCESSING','RETRY_WAIT')) AS active,
    count(*) FILTER(WHERE session_id=$1 AND status IN ('ACCEPTED','PROCESSING','RETRY_WAIT')) AS own FROM operations`,
          [sessionId],
        )
      ).rows[0];
      if (Number(counts.active) >= this.cfg.maxActive || Number(counts.own) >= 2)
        throw new AppError(429, 'ACTIVE_LIMIT', 'Espera a que terminen las operaciones pendientes');
      if (Number(counts.total) >= 1000)
        throw new AppError(503, 'DEMO_CAPACITY', 'Se alcanzó la capacidad temporal de la demo');
      const id = randomUUID();
      const op = (
        await tx.query(
          `INSERT INTO operations(id,session_id,idempotency_key,client_order_id,payload_hash,request_json,status,deadline_at)
    VALUES($1,$2,$3,$4,$5,$6,'ACCEPTED',clock_timestamp()+$7*interval '1 millisecond') RETURNING *`,
          [
            id,
            sessionId,
            key,
            input.clientOrderId,
            fingerprint,
            JSON.stringify(payload),
            this.cfg.operationDeadlineMs,
          ],
        )
      ).rows[0];
      await this.event(tx, op, 'ACCEPTED');
      return { op, replayed: false };
    });
  }
  // Every state mutation uses the same lock order: session, then operation.
  async locked<T>(operationId: string, fn: (tx: Tx, op: Row) => Promise<T>): Promise<T> {
    const found = (
      await this.db.pool.query('SELECT session_id FROM operations WHERE id=$1', [operationId])
    ).rows[0];
    if (!found) throw missing();
    return this.db.tx(async (tx) => {
      await tx.query('SELECT id FROM demo_sessions WHERE id=$1 FOR UPDATE', [found.session_id]);
      const op = (await tx.query('SELECT * FROM operations WHERE id=$1 FOR UPDATE', [operationId]))
        .rows[0];
      if (!op) throw missing();
      return fn(tx, op);
    });
  }
  assertAttempt(op: Row, token: string) {
    if (
      isTerminal(op.status) ||
      !op.attempt_token ||
      op.attempt_token !== token ||
      !op.lease_until ||
      new Date(op.lease_until).getTime() <= Date.now() ||
      new Date(op.deadline_at).getTime() <= Date.now()
    )
      throw new AppError(409, 'STALE_ATTEMPT', 'Intento vencido o revocado');
  }
  async reserve(operationId: string) {
    return this.locked(operationId, async (tx, op) => {
      if (isTerminal(op.status)) return null;
      if (await this.finishReceipt(tx, op)) return null;
      if (op.lease_until && new Date(op.lease_until).getTime() > Date.now()) return null;
      if (new Date(op.deadline_at).getTime() <= Date.now() || op.attempt_count >= 3) {
        await this.fail(tx, op);
        return null;
      }
      if (new Date(op.next_attempt_at).getTime() > Date.now()) return null;
      const token = randomUUID();
      await tx.query(
        `UPDATE operations SET attempt_count=attempt_count+1,attempt_token=$2,execution_id=NULL,lease_until=clock_timestamp()+$3*interval '1 millisecond' WHERE id=$1`,
        [op.id, token, this.cfg.leaseMs],
      );
      return { schemaVersion: 1, operationId: op.id as string, attemptToken: token };
    });
  }
  async claim(id: string, token: string, executionId: string) {
    return this.locked(id, async (tx, op) => {
      this.assertAttempt(op, token);
      if (op.execution_id)
        throw new AppError(409, 'ALREADY_CLAIMED', 'El intento ya tiene una ejecución');
      await tx.query(
        'INSERT INTO execution_attempts(execution_id,operation_id,attempt_token) VALUES($1,$2,$3)',
        [executionId, id, token],
      );
      await tx.query('UPDATE operations SET execution_id=$2 WHERE id=$1', [id, executionId]);
      await this.event(tx, op, 'PROCESSING');
      return { operationId: id, attemptToken: token, ...op.request_json };
    });
  }
  async processErp(id: string, token: string, input: OrderInput) {
    return this.locked(id, async (tx, op) => {
      const existing = (await tx.query('SELECT * FROM erp_receipts WHERE operation_id=$1', [id]))
        .rows[0];
      if (existing) return { receipt: this.receiptJson(existing), created: false };
      this.assertAttempt(op, token);
      if (op.status !== 'PROCESSING' || !op.execution_id)
        throw new AppError(409, 'NOT_CLAIMED', 'La ejecución debe reclamar el pedido');
      if (hashOrder(input) !== op.payload_hash)
        throw new AppError(
          422,
          'ERP_PAYLOAD_MISMATCH',
          'El contrato ERP no coincide con la operación',
        );
      const original = (
        await tx.query(
          'SELECT * FROM business_receipts WHERE session_id=$1 AND client_order_id=$2',
          [op.session_id, input.clientOrderId],
        )
      ).rows[0];
      let outcome: Status = 'SUCCEEDED',
        result = emptyResult('ORDER_CREATED');
      if (original) {
        if (original.payload_hash === op.payload_hash) {
          outcome = 'DUPLICATE';
          result = {
            ...emptyResult('ORDER_ALREADY_PROCESSED'),
            orderId: original.order_id,
            originalOperationId: original.original_operation_id,
            originalStatus: original.outcome,
          };
        } else {
          outcome = 'REJECTED';
          result = emptyResult('ORDER_ID_CONFLICT');
        }
      } else {
        const stock = (
          await tx.query(
            'SELECT sku,available FROM session_stock WHERE session_id=$1 ORDER BY sku FOR UPDATE',
            [op.session_id],
          )
        ).rows;
        const unavailable = input.items
          .filter((line) => line.quantity > (stock.find((s) => s.sku === line.sku)?.available ?? 0))
          .map((line) => ({
            sku: line.sku,
            requested: line.quantity,
            available: stock.find((s) => s.sku === line.sku)?.available ?? 0,
          }));
        if (unavailable.length) {
          outcome = 'REJECTED';
          result = { ...emptyResult('INSUFFICIENT_STOCK'), details: unavailable };
        } else {
          result.orderId = randomUUID();
          await tx.query(
            'INSERT INTO orders(id,session_id,client_order_id,operation_id) VALUES($1,$2,$3,$4)',
            [result.orderId, op.session_id, input.clientOrderId, id],
          );
          for (const line of canonicalOrder(input).items) {
            await tx.query(
              'UPDATE session_stock SET available=available-$3 WHERE session_id=$1 AND sku=$2',
              [op.session_id, line.sku, line.quantity],
            );
            await tx.query(
              'INSERT INTO order_items(session_id,order_id,sku,quantity) VALUES($1,$2,$3,$4)',
              [op.session_id, result.orderId, line.sku, line.quantity],
            );
          }
        }
        await tx.query(
          `INSERT INTO business_receipts(id,session_id,client_order_id,payload_hash,original_operation_id,outcome,code,order_id,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            op.session_id,
            input.clientOrderId,
            op.payload_hash,
            id,
            outcome,
            result.code,
            result.orderId,
            JSON.stringify(result.details),
          ],
        );
      }
      const receipt = (
        await tx.query(
          `INSERT INTO erp_receipts(id,session_id,operation_id,outcome,code,order_id,original_operation_id,original_status,details_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            randomUUID(),
            op.session_id,
            id,
            outcome,
            result.code,
            result.orderId,
            result.originalOperationId,
            result.originalStatus,
            JSON.stringify(result.details),
          ],
        )
      ).rows[0];
      return { receipt: this.receiptJson(receipt), created: true };
    });
  }
  receiptJson(r: Row) {
    return {
      receiptId: r.id,
      operationId: r.operation_id,
      outcome: r.outcome,
      code: r.code,
      orderId: r.order_id,
      originalOperationId: r.original_operation_id,
      originalStatus: r.original_status,
      details: r.details_json,
    };
  }
  async finishReceipt(tx: Tx, op: Row, receiptId?: string) {
    const receipt = (await tx.query('SELECT * FROM erp_receipts WHERE operation_id=$1', [op.id]))
      .rows[0];
    if (!receipt) return false;
    if (receiptId && receipt.id !== receiptId)
      throw new AppError(409, 'RECEIPT_MISMATCH', 'Recibo incompatible');
    if (!isTerminal(op.status)) {
      const { receiptId: _, operationId: __, outcome, ...result } = this.receiptJson(receipt);
      await this.event(tx, op, outcome, result.code, result);
      await tx.query('UPDATE operations SET attempt_token=NULL,lease_until=NULL WHERE id=$1', [
        op.id,
      ]);
    }
    return true;
  }
  async finalize(id: string, token: string, receiptId: string) {
    return this.locked(id, async (tx, op) => {
      if (!isTerminal(op.status)) this.assertAttempt(op, token);
      if (!(await this.finishReceipt(tx, op, receiptId)))
        throw new AppError(409, 'RECEIPT_REQUIRED', 'Todavía no hay un recibo');
      return { status: op.status };
    });
  }
  async fail(tx: Tx, op: Row) {
    await tx.query('UPDATE operations SET attempt_token=NULL,lease_until=NULL WHERE id=$1', [
      op.id,
    ]);
    await this.event(
      tx,
      op,
      'FAILED_TECHNICAL',
      'INTEGRATION_UNAVAILABLE',
      emptyResult('INTEGRATION_UNAVAILABLE'),
    );
  }
  async reportFailure(id: string, token: string, retryable: boolean) {
    return this.locked(id, async (tx, op) => {
      if (isTerminal(op.status)) return { status: op.status };
      if (op.attempt_token !== token) throw new AppError(409, 'STALE_ATTEMPT', 'Intento revocado');
      if (await this.finishReceipt(tx, op)) return { status: op.status };
      if (!retryable || op.attempt_count >= 3 || new Date(op.deadline_at).getTime() <= Date.now())
        await this.fail(tx, op);
      else {
        const delay = (op.attempt_count === 1 ? 2000 : 5000) + Math.floor(Math.random() * 300);
        await tx.query(
          `UPDATE operations SET attempt_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+$2*interval '1 millisecond' WHERE id=$1`,
          [id, delay],
        );
        await this.event(tx, op, 'RETRY_WAIT', 'RETRY_SCHEDULED');
      }
      return { status: op.status };
    });
  }
  async operation(id: string, visitorId: string) {
    const op = (
      await this.db.pool.query(
        'SELECT o.* FROM operations o JOIN demo_sessions s ON s.id=o.session_id WHERE o.id=$1 AND s.visitor_id=$2',
        [id, visitorId],
      )
    ).rows[0];
    if (!op) throw missing();
    const events = (
      await this.db.pool.query(
        'SELECT sequence,status,at FROM operation_events WHERE operation_id=$1 ORDER BY sequence',
        [id],
      )
    ).rows;
    return {
      operationId: op.id,
      clientOrderId: op.client_order_id,
      status: op.status,
      attemptCount: op.attempt_count,
      updatedAt: op.updated_at,
      nextRetryAt: op.status === 'RETRY_WAIT' ? op.next_attempt_at : null,
      result: op.result_json,
      events,
    };
  }
  async cleanup() {
    const sessions = (
      await this.db.pool.query(`SELECT id FROM demo_sessions WHERE status<>'EXPIRED' ORDER BY id`)
    ).rows;
    for (const s of sessions)
      await this.db.tx(async (tx) => {
        const row = (await tx.query('SELECT * FROM demo_sessions WHERE id=$1 FOR UPDATE', [s.id]))
          .rows[0];
        if (!row) return;
        if (row.status === 'ACTIVE' && new Date(row.expires_at).getTime() <= Date.now())
          await tx.query(
            `UPDATE demo_sessions SET status='CLOSING',closed_at=clock_timestamp() WHERE id=$1`,
            [s.id],
          );
        const active = (
          await tx.query(
            `SELECT 1 FROM operations WHERE session_id=$1 AND status IN ('ACCEPTED','PROCESSING','RETRY_WAIT') LIMIT 1`,
            [s.id],
          )
        ).rowCount;
        if (!active)
          await tx.query(
            `UPDATE demo_sessions SET status='EXPIRED',purge_after=clock_timestamp()+interval '24 hours' WHERE id=$1 AND status='CLOSING'`,
            [s.id],
          );
      });
    // Remove children in FK order, only after fencing every admitted operation.
    const expired = (
      await this.db.pool.query(
        `SELECT id FROM demo_sessions WHERE status='EXPIRED' AND purge_after<clock_timestamp()`,
      )
    ).rows;
    for (const s of expired)
      await this.db.tx(async (tx) => {
        const row = (
          await tx.query(
            `SELECT id FROM demo_sessions WHERE id=$1 AND status='EXPIRED' AND purge_after<clock_timestamp() FOR UPDATE`,
            [s.id],
          )
        ).rows[0];
        if (!row) return;
        for (const table of ['erp_receipts', 'business_receipts', 'order_items', 'orders'])
          await tx.query(`DELETE FROM ${table} WHERE session_id=$1`, [s.id]);
        await tx.query('DELETE FROM demo_sessions WHERE id=$1', [s.id]);
      });
    await this.db.pool.query(
      'DELETE FROM visitors v WHERE NOT EXISTS(SELECT 1 FROM demo_sessions s WHERE s.visitor_id=v.id)',
    );
    await this.db.pool.query('DELETE FROM rate_buckets WHERE expires_at<clock_timestamp()');
  }
}
