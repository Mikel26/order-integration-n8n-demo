# Decisiones de arquitectura

## Flujo y responsabilidad

La API de entrada persiste `operations` y un evento `ACCEPTED` en una transacción. Devuelve `202` y un `operationId`. La fila es la bandeja duradera; si el proceso cae después del acuse, el worker puede entregarla al recuperarse.

El dispatcher toma un intento, genera un token y una concesión de 30 segundos. El webhook n8n responde inmediatamente. n8n reclama la operación, asocia su `executionId`, transforma el contrato web al ERP y procesa el resultado. Un segundo workflow se ocupa de errores inesperados. El ERP no es una colección de nodos SQL: mantiene las reglas transaccionales en un servicio probado.

## Tres identidades

| Identidad         | Alcance                                | Función                                             |
| ----------------- | -------------------------------------- | --------------------------------------------------- |
| `operationId`     | Una admisión                           | Seguimiento de estados                              |
| `Idempotency-Key` | Única por sesión                       | Reenvío del mismo envío sin nueva operación         |
| `clientOrderId`   | Único por sesión en recibos de negocio | Deduplicación del pedido, incluso con claves nuevas |

Se ordenan las líneas y se calcula una huella del pedido normalizado. Misma clave con otro contenido produce `409`; mismo pedido con otro contenido produce un rechazo de negocio. Un rechazo por stock también genera un recibo duradero: un duplicado no reevalúa sus reglas. Los pedidos corregidos usan otro identificador.

## Atomicidad y carreras

Todas las mutaciones del dominio bloquean **sesión → operación → stock por SKU**. El bloqueo por sesión serializa su pequeño inventario; distintas sesiones progresan de forma independiente. El ERP confirma pedido, líneas, descuento y recibos en una transacción. Un fallo antes del COMMIT revierte todo.

La publicación del resultado es posterior al recibo ERP. Si se pierde la respuesta o el callback, el reconciliador carga ese recibo y publica el estado sin descontar de nuevo. Para declarar un fallo técnico, toma los mismos bloqueos, comprueba otra vez el recibo y revoca el token. Una ejecución tardía no puede escribir con un token revocado o una operación terminal. Se usa `READ COMMITTED` con bloqueos explícitos, restricciones únicas y `CHECK available >= 0`.

No hay transacción distribuida ni garantía de entrega exactamente una vez. Hay entrega repetible con un único efecto de negocio bajo estas restricciones.

## Sesión frente a visitante

La implementación añade `visitors` respecto del modelo lógico original. La cookie opaca identifica un visitante anónimo y se almacena solo su hash. El visitante apunta a la sesión activa; las sesiones anteriores conservan su propiedad hasta purgarse. Esto permite consultar una operación anterior por ID después de reiniciar, sin reutilizar ni resembrar su inventario.

El limpiador cierra sesiones vencidas y solo las expira cuando todas sus operaciones son terminales. Elimina recibos/pedidos en orden de FK y purga la sesión tras la retención. Al reiniciar, se crea otro inventario atómicamente. La UI espera a que termine la operación seleccionada antes de ofrecer su reinicio; las carreras siguen cubiertas en el backend.

## Seguridad y despliegue

Los listeners públicos e internos son distintos. Compose solo publica el listener de la API pública en localhost; ERP e interno permanecen en la red Docker. Hay Header Auth para el webhook y secretos distintos para las APIs internas. Los contenedores reciben solo los secretos necesarios; n8n guarda credenciales cifradas en su propia base.

El navegador usa cookie HttpOnly/SameSite y cada mutación comprueba `Origin`. Esquemas JSON rechazan campos inesperados, cantidades no enteras, SKU desconocidos y cuerpos mayores de 8 KiB. SQL parametrizado. Los IDs no sustituyen el control de propiedad.

Para publicar detrás de un proxy, `TRUSTED_PROXY_CIDR` debe ser su IP/CIDR exacto. Nginx reemplaza `X-Forwarded-For` con la dirección que observó, sin conservar un valor elegido por el cliente. No se debe habilitar confianza global ni exponer directamente la API a Internet en esa configuración. Ver [trustProxy oficial de Fastify](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

## Simplificaciones conscientes

- API y ERP comparten la base de dominio: permite resolver carreras sin coordinar varios sistemas.
- Un pool pequeño por proceso y un solo dispatcher; los tokens y bloqueos permiten entregas repetidas, pero no se presenta como arquitectura de alta disponibilidad.
- n8n en modo regular con concurrencia de producción limitada a dos; sin Redis ni queue mode.
- El presupuesto de reintentos se mantiene en PostgreSQL; los nodos no agregan sus propios reintentos.
- No se usa el historial de n8n como fuente de verdad del negocio.
- Los fallos del handler o la caída total de n8n se resuelven por vencimiento de la concesión, no exclusivamente mediante callbacks.
