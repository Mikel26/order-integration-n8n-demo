import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export default defineConfig({
  test: { testTimeout: 15000, hookTimeout: 15000, exclude: ['tests/e2e/**', 'node_modules/**'] },
});
