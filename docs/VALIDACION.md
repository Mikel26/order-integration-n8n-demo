# Validación local

Fecha: 29 de octubre de 2026. Entorno: macOS, Node 24.12.0 y Docker Desktop. Se creó un proyecto Compose separado (`order-demo-clean`) con volúmenes nuevos, sin reutilizar el esquema ni las credenciales almacenadas de pruebas anteriores. Las migraciones y la importación/publicación de ambos workflows ocurrieron automáticamente.

| Comprobación                           | Resultado                                                 |
| -------------------------------------- | --------------------------------------------------------- |
| TypeScript estricto                    | Correcto                                                  |
| Build servidor y Angular en Docker     | Correcto                                                  |
| Unitarias                              | 2 / 2                                                     |
| PostgreSQL real                        | 15 / 15                                                   |
| Escenarios n8n de extremo a extremo    | `SUCCEEDED`, `REJECTED`, `DUPLICATE`; stock final `3/2/2` |
| Caída temporal del ERP                 | Una ejecución real del handler; éxito en dos intentos     |
| Navegador de escritorio y móvil        | 2 / 2, sin errores JavaScript en el recorrido principal   |
| Política CSP y estilos                 | Comprobación CSS en E2E y revisión visual de capturas     |
| Video de respaldo                      | Grabación real de A/B/C en `docs/demo.webm`               |
| Auditoría npm al instalar dependencias | 0 vulnerabilidades reportadas                             |

Las pruebas de integración cubren idempotencia concurrente, duplicados de negocio concurrentes, sobreventa, rechazo multilínea, rollback por fallo de escritura, recibos tras respuesta perdida, ejecución tardía, carrera con cierre técnico, presupuesto de reintentos, aislamiento, reinicio/expiración/purga, validación HTTP, autenticación y falsificación de IP sin proxy confiable.

La recuperación observada fue:

```text
ACCEPTED → PROCESSING → RETRY_WAIT → PROCESSING → SUCCEEDED
```

## Versiones de aplicación verificadas

| Paquete            | Versión en lockfile |
| ------------------ | ------------------- |
| `@angular/core`    | `21.2.25`           |
| `@angular/build`   | `21.2.29`           |
| `fastify`          | `5.12.7`            |
| `pg`               | `8.23.1`            |
| `typescript`       | `5.9.3`             |
| `vitest`           | `4.1.12`            |
| `@playwright/test` | `1.64.1`            |

Imágenes de referencia: Node `24.12.0-alpine`, PostgreSQL `17.6-alpine`, n8n `2.45.6` y Nginx `1.28.0-alpine`. Las etiquetas están fijadas; no constituyen una afirmación de que sean siempre la última versión disponible. Revisar actualizaciones antes de publicar y volver a ejecutar la validación.

## Límites de esta evidencia

No hay ensayo de alta disponibilidad, carga de producción ni SLA medido. La auditoría npm no evalúa el sistema operativo de las imágenes. La autenticación del editor n8n no forma parte de los recorridos automatizados; el editor está ligado a localhost. Esta evidencia corresponde a la validación local anterior a la publicación del código. La live demo pública sigue pendiente; las ejecuciones remotas posteriores pueden consultarse en [GitHub Actions](https://github.com/Mikel26/order-integration-n8n-demo/actions/workflows/ci.yml). No se afirma experiencia productiva con un ERP comercial.

## Preparación del despliegue — 30 de octubre de 2026

- TypeScript y build Angular correctos.
- 20 pruebas unitarias correctas: incluyen el proxy público y la creación segura de configuración privada.
- `deploy/compose.live.yaml` arrancó con volúmenes nuevos en un proyecto local separado.
- HTTPS local con certificado de una CA de prueba: recorrido A/B/C mediante n8n real correcto, stock `3/2/2`.
- La ruta `/internal/operations/test` devolvió HTTP 404 desde el proxy público.
- Esta validación no equivale a un despliegue en Oracle: siguen pendientes la cuenta, la VM gratuita y su DNS público.

### Verificación pública de Vercel

- URL canónica: [https://order-integration-n8n-demo.vercel.app](https://order-integration-n8n-demo.vercel.app).
- HTTP 200 sin sesión de Vercel; API de sesiones HTTP 503 con código `DEMO_OFFLINE` por backend aún no configurado.
- Navegador aislado: mensaje de preparación, estilos correctos, envío deshabilitado y cero errores JavaScript.
- El proxy también pasó A/B/C contra el backend HTTPS local mediante n8n real. Esto valida el transporte y las cookies; no sustituye la verificación posterior de la VM Oracle.
