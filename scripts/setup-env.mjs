import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const secret = () => randomBytes(32).toString('hex');
const postgres = secret(), demo = secret(), n8n = secret();
const vars = {POSTGRES_PASSWORD:postgres,DEMO_DB_PASSWORD:demo,N8N_DB_PASSWORD:n8n,DATABASE_URL:`postgres://demo:${demo}@localhost:5433/orders_demo`,TEST_DATABASE_URL:`postgres://demo:${demo}@localhost:5433/orders_test`,N8N_ENCRYPTION_KEY:secret(),WEBHOOK_SECRET:secret(),INTERNAL_SECRET:secret(),ERP_SECRET:secret(),PUBLIC_ORIGIN:'http://localhost:4200',API_PORT:'3000',INTERNAL_PORT:'3001',ERP_PORT:'3002',N8N_WEBHOOK_URL:'http://localhost:5678/webhook/order-import',COOKIE_SECURE:'false'};
try { writeFileSync('.env', Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('\n')+'\n', {flag:'wx',mode:0o600}); console.log('.env creado con secretos locales aleatorios.'); }
catch (e) { if(e.code==='EEXIST') console.log('.env ya existe; se conserva.'); else throw e; }
