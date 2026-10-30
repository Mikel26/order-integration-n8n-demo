import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const { values } = parseArgs({
  options: {
    frontend: { type: 'string' },
    'api-host': { type: 'string' },
    output: { type: 'string', default: '.env.live' },
  },
});
let origin;
try {
  const u = new URL(values.frontend ?? '');
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new Error();
  origin = u.origin;
} catch {
  throw new Error('Usa --frontend https://tu-proyecto.vercel.app, sin ruta ni credenciales');
}
const host = values['api-host'] ?? '';
if (
  host.length > 253 ||
  !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
    host,
  )
)
  throw new Error('Usa --api-host con un nombre DNS público válido');
const secret = () => randomBytes(32).toString('hex');
const vars = {
  POSTGRES_PASSWORD: secret(),
  DEMO_DB_PASSWORD: secret(),
  N8N_DB_PASSWORD: secret(),
  N8N_ENCRYPTION_KEY: secret(),
  WEBHOOK_SECRET: secret(),
  INTERNAL_SECRET: secret(),
  ERP_SECRET: secret(),
  PUBLIC_ORIGIN: origin,
  API_HOSTNAME: host.toLowerCase(),
};
try {
  writeFileSync(
    values.output,
    Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Configuración privada creada. Conserva este archivo fuera de Git y transfiérelo al servidor mediante SSH.',
  );
} catch (e) {
  if (e.code === 'EEXIST')
    throw new Error('El archivo ya existe; se conserva para no rotar secretos accidentalmente.');
  throw e;
}
