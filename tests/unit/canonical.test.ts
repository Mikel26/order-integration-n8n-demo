import { describe, expect, it } from 'vitest';
import { hashOrder } from '../../packages/core/src/canonical.js';
describe('Identidad del pedido', () => {
  const input = {
    clientOrderId: 'WEB-1',
    items: [
      { sku: 'DEMO-002', quantity: 1 },
      { sku: 'DEMO-001', quantity: 2 },
    ],
  };
  it('ignora el orden de las líneas', () =>
    expect(hashOrder(input)).toBe(hashOrder({ ...input, items: [...input.items].reverse() })));
  it('distingue cambios de cantidad e identificador', () => {
    expect(hashOrder(input)).not.toBe(hashOrder({ ...input, clientOrderId: 'WEB-2' }));
    expect(hashOrder(input)).not.toBe(
      hashOrder({ ...input, items: [{ sku: 'DEMO-001', quantity: 1 }] }),
    );
  });
});
