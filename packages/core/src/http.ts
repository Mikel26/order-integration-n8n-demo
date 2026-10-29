import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from './db.js';
export const uuidSchema = { type: 'string', format: 'uuid' };
export const idParams = { type: 'object', required: ['id'], properties: { id: uuidSchema } };
export const tokenBody = {
  type: 'object',
  additionalProperties: false,
  required: ['attemptToken'],
  properties: { attemptToken: uuidSchema },
};
export function server(logger = true, trustedProxy?: string): FastifyInstance {
  const app = Fastify({
    trustProxy: trustedProxy || false,
    logger: logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers.x-internal-secret',
            'req.headers.x-erp-secret',
            'req.headers.x-webhook-secret',
          ],
        }
      : false,
    bodyLimit: 8192,
    requestTimeout: 10000,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  app.setErrorHandler((caught, request, reply) => {
    const error = caught as FastifyError;
    if (error instanceof AppError) {
      if (error.statusCode === 429) reply.header('Retry-After', '60');
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, requestId: request.id } });
    }
    if (error.validation)
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Revisa el formato y las cantidades',
          requestId: request.id,
        },
      });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({
        error: { code: 'INVALID_REQUEST', message: 'Solicitud no válida', requestId: request.id },
      });
    request.log.error(
      {
        code: typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR',
        requestId: request.id,
      },
      'Error interno',
    );
    return reply.code(503).send({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Servicio temporalmente no disponible',
        requestId: request.id,
      },
    });
  });
  return app;
}
export function authorize(actual: unknown, secret: string) {
  if (
    typeof actual !== 'string' ||
    Buffer.byteLength(actual) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(secret))
  )
    throw new AppError(401, 'UNAUTHORIZED', 'Autenticación requerida');
}
