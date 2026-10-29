import { Database } from '../../../packages/core/src/db.js';
import { Domain } from '../../../packages/core/src/domain.js';
import { configFromEnv } from '../../../packages/core/src/config.js';
import { tick } from './worker.js';
const cfg = configFromEnv('worker'),
  db = new Database(cfg.databaseUrl),
  domain = new Domain(db, cfg);
let stopped = false,
  lastCleanup = 0;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopped = true;
  });
while (!stopped) {
  try {
    await tick(domain);
    if (Date.now() - lastCleanup > 60_000) {
      await domain.cleanup();
      lastCleanup = Date.now();
    }
  } catch {
    console.error(JSON.stringify({ event: 'worker_tick_failed' }));
  }
  await new Promise((r) => setTimeout(r, 500));
}
await db.close();
