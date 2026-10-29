export const PRODUCTS = [
  { sku: 'DEMO-001', name: 'Teclado de ejemplo', initialStock: 5 },
  { sku: 'DEMO-002', name: 'Mouse de ejemplo', initialStock: 3 },
  { sku: 'DEMO-003', name: 'Audífonos de ejemplo', initialStock: 2 },
] as const;
export type Status =
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'RETRY_WAIT'
  | 'SUCCEEDED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'FAILED_TECHNICAL';
export const TERMINAL: Status[] = ['SUCCEEDED', 'REJECTED', 'DUPLICATE', 'FAILED_TECHNICAL'];
export const isTerminal = (status: Status) => TERMINAL.includes(status);
export interface OrderInput {
  clientOrderId: string;
  items: { sku: string; quantity: number }[];
}
export interface Result {
  code: string;
  orderId: string | null;
  originalOperationId: string | null;
  originalStatus: string | null;
  details: unknown[];
}
export interface Operation {
  operationId: string;
  clientOrderId: string;
  status: Status;
  attemptCount: number;
  updatedAt: string;
  nextRetryAt: string | null;
  result: Result | null;
  events: { sequence: number; status: Status; at: string }[];
}
export interface Stock {
  sku: string;
  name: string;
  available: number;
}
export interface Order {
  orderId: string;
  clientOrderId: string;
  items: OrderInput['items'];
  createdAt: string;
}
export const orderSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientOrderId', 'items'],
  properties: {
    clientOrderId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sku', 'quantity'],
        properties: {
          sku: { type: 'string', enum: PRODUCTS.map((p) => p.sku) },
          quantity: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
    },
  },
} as const;
