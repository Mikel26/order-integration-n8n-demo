import { createHash } from 'node:crypto';
import type { OrderInput } from '../../contracts/src/index.js';
export function canonicalOrder(input: OrderInput): OrderInput {
  return { clientOrderId: input.clientOrderId, items: [...input.items].sort((a,b) => a.sku.localeCompare(b.sku)).map(({sku,quantity}) => ({sku,quantity})) };
}
export const hashOrder = (input: OrderInput) => createHash('sha256').update(JSON.stringify({schemaVersion: 1, ...canonicalOrder(input)})).digest('hex');
