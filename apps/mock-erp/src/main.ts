import { configFromEnv } from '../../../packages/core/src/config.js';
import { Database } from '../../../packages/core/src/db.js';
import { Domain } from '../../../packages/core/src/domain.js';
import { erpApp } from './app.js';
const cfg = configFromEnv('erp'),
  db = new Database(cfg.databaseUrl),
  app = await erpApp(new Domain(db, cfg));
await app.listen({ host: '0.0.0.0', port: Number(process.env.ERP_PORT ?? 3002) });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
