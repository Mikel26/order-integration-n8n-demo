import type { Domain } from '../../../packages/core/src/domain.js';
export async function tick(domain: Domain) {
  const pending = (
    await domain.db.pool.query(
      `SELECT id FROM operations WHERE status IN ('ACCEPTED','PROCESSING','RETRY_WAIT') ORDER BY created_at LIMIT 20`,
    )
  ).rows;
  for (const row of pending) {
    try {
      const attempt = await domain.reserve(row.id);
      if (!attempt) continue;
      try {
        const response = await fetch(domain.cfg.webhookUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-secret': domain.cfg.webhookSecret,
          },
          body: JSON.stringify(attempt),
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
        });
        await response.arrayBuffer();
        if (!response.ok)
          await domain.reportFailure(
            row.id,
            attempt.attemptToken,
            response.status === 429 || response.status >= 500,
          );
      } catch {
        await domain.reportFailure(row.id, attempt.attemptToken, true);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'worker_operation_failed',
          operationId: row.id,
          code: (error as { code?: string }).code ?? 'WORKER_ERROR',
        }),
      );
    }
  }
}
