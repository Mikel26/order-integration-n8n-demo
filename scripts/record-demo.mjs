import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('test-results/recording', { recursive: true });
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1080 },
  recordVideo: { dir: 'test-results/recording', size: { width: 1440, height: 1080 } },
});
const page = await context.newPage();
async function caption(text) {
  await page.evaluate((text) => {
    let label = document.querySelector('#recording-caption');
    if (!label) {
      label = document.createElement('div');
      label.id = 'recording-caption';
      Object.assign(label.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#101b2a',
        color: 'white',
        padding: '16px 24px',
        borderRadius: '10px',
        zIndex: '1000',
        font: '15px system-ui',
        boxShadow: '0 5px 20px #0003',
        whiteSpace: 'nowrap',
      });
      document.body.append(label);
    }
    label.textContent = text;
  }, text);
  console.log(text);
}
try {
  await page.goto(process.env.DEMO_WEB_URL ?? 'http://localhost:4200');
  await expect(page.getByRole('button', { name: 'Pedido válido', exact: true })).toBeEnabled();
  await caption('Orderflow · Angular → API → n8n → ERP simulado → PostgreSQL');
  await page.waitForTimeout(9000);
  await page.getByRole('button', { name: 'Pedido válido', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Pedido confirmado', {
    timeout: 30_000,
  });
  await caption('01 · Pedido confirmado: stock 3 / 2 / 2, un registro en el ERP');
  await page.waitForTimeout(14000);
  await page.getByRole('button', { name: 'Stock insuficiente', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Pedido rechazado', {
    timeout: 30_000,
  });
  await caption('02 · Stock insuficiente: rechazo de negocio, sin descuentos parciales');
  await page.waitForTimeout(14000);
  await page.getByRole('button', { name: 'Duplicar último pedido', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Duplicado detectado', {
    timeout: 30_000,
  });
  await caption('03 · Mismo pedido, nueva clave: duplicado detectado, sin otro descuento');
  await page.waitForTimeout(14000);
  await page.locator('.activity').scrollIntoViewIfNeeded();
  await caption('Tres operaciones · un pedido confirmado · datos ficticios y sesión privada');
  await page.waitForTimeout(11000);
  const video = page.video();
  await context.close();
  await video.saveAs('docs/demo.webm');
  console.log('Video real guardado en docs/demo.webm');
} finally {
  await browser.close();
}
