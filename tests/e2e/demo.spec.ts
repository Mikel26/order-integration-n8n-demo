import { test, expect } from '@playwright/test';

test('recorre pedido válido, rechazo y duplicado mediante n8n real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(16, 27, 42)');
  await expect(page.getByRole('button', { name: 'Pedido válido', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pedido válido', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Pedido confirmado', {
    timeout: 30_000,
  });
  await expect(page.locator('.stock-number')).toHaveText(['3', '2', '2']);
  await expect(page.locator('.confirmed tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Stock insuficiente', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Pedido rechazado', {
    timeout: 30_000,
  });
  await expect(page.locator('.stock-number')).toHaveText(['3', '2', '2']);
  await page.getByRole('button', { name: 'Duplicar último pedido', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Duplicado detectado', {
    timeout: 30_000,
  });
  await expect(page.locator('.stock-number')).toHaveText(['3', '2', '2']);
  await expect(page.locator('.activity tbody tr')).toHaveCount(3);
  await expect(page.locator('.confirmed tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.activity tbody tr')).toHaveCount(3);
  await page.locator('.activity tbody .table-link').first().click();
  await expect(page.locator('.tracking .status')).toHaveText('Duplicado detectado');
  await page.screenshot({ path: 'docs/screenshots/demo-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('funciona en móvil y permite reiniciar con stock privado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pedido válido', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pedido válido', exact: true }).click();
  await expect(page.locator('.tracking .status')).toHaveText('Pedido confirmado', {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Reiniciar demo' }).click();
  await expect(page.locator('.stock-number')).toHaveText(['5', '3', '2']);
  await expect(page.locator('.empty-tracking')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'docs/screenshots/demo-mobile.png', fullPage: true });
});
