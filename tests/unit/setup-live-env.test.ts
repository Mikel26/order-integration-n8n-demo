import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
function run(output: string, frontend = 'https://orderflow.vercel.app') {
  return spawnSync(
    process.execPath,
    [
      'scripts/setup-live-env.mjs',
      '--frontend',
      frontend,
      '--api-host',
      'orders.example.test',
      '--output',
      output,
    ],
    { encoding: 'utf8' },
  );
}
describe('Configuración privada del despliegue', () => {
  it('genera secretos nuevos, un origen HTTPS y permisos restringidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'order-live-env-'));
    try {
      const path = join(dir, '.env.live');
      const result = run(path);
      expect(result.status).toBe(0);
      const values = Object.fromEntries(
        readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .map((l) => l.split('=')),
      );
      expect(values.PUBLIC_ORIGIN).toBe('https://orderflow.vercel.app');
      expect(values.API_HOSTNAME).toBe('orders.example.test');
      expect(
        Object.entries(values)
          .filter(([key]) => key.endsWith('SECRET'))
          .every(([, value]) => typeof value === 'string' && value.length === 64),
      ).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('conserva un archivo existente en vez de rotar sus credenciales', () => {
    const dir = mkdtempSync(join(tmpdir(), 'order-live-env-'));
    try {
      const path = join(dir, '.env.live');
      writeFileSync(path, 'keep');
      expect(run(path).status).not.toBe(0);
      expect(readFileSync(path, 'utf8')).toBe('keep');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rechaza un origen HTTP antes de escribir secretos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'order-live-env-'));
    try {
      expect(run(join(dir, '.env.live'), 'http://example.test').status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
