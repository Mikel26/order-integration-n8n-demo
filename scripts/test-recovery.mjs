import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
const before = Number(
  docker([
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'n8n',
    '-tAc',
    `SELECT count(*) FROM execution_entity WHERE "workflowId"='orderImportErrors'`,
  ]),
);
const origin = 'http://localhost:4200';
const created = await fetch('http://localhost:3000/api/demo-sessions', {
  method: 'POST',
  headers: { origin },
});
assert.ok(created.ok, `Sesión: ${created.status}`);
const cookie = created.headers.getSetCookie()[0].split(';')[0];
docker(['compose', 'stop', 'mock-erp']);
try {
  const response = await fetch('http://localhost:3000/api/orders', {
    method: 'POST',
    headers: {
      origin,
      cookie,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    body: JSON.stringify({
      clientOrderId: `RECOVERY-${randomUUID().slice(0, 8)}`,
      items: [{ sku: 'DEMO-001', quantity: 1 }],
    }),
  });
  assert.equal(response.status, 202);
  const admitted = await response.json();
  let sawRetry = false;
  for (let i = 0; i < 30; i++) {
    const op = await (
      await fetch(`http://localhost:3000${admitted.statusUrl}`, { headers: { cookie } })
    ).json();
    if (op.status === 'RETRY_WAIT') {
      sawRetry = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(sawRetry, 'El handler debe publicar RETRY_WAIT');
  docker(['compose', 'start', 'mock-erp']);
  let result;
  for (let i = 0; i < 30; i++) {
    result = await (
      await fetch(`http://localhost:3000${admitted.statusUrl}`, { headers: { cookie } })
    ).json();
    if (result.status === 'SUCCEEDED') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  assert.equal(result.status, 'SUCCEEDED');
  assert.ok(result.attemptCount >= 2);
  const after = Number(
    docker([
      'compose',
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'n8n',
      '-tAc',
      `SELECT count(*) FROM execution_entity WHERE "workflowId"='orderImportErrors'`,
    ]),
  );
  assert.ok(after > before, 'Debe ejecutarse el error workflow real');
  console.log(
    JSON.stringify(
      {
        errorHandlerExecutions: after - before,
        status: result.status,
        attempts: result.attemptCount,
        events: result.events.map((e) => e.status),
      },
      null,
      2,
    ),
  );
} finally {
  docker(['compose', 'start', 'mock-erp']);
}
