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

No hay ensayo de alta disponibilidad, carga de producción ni SLA medido. La auditoría npm no evalúa el sistema operativo de las imágenes. La autenticación del editor n8n no forma parte de los recorridos automatizados; el editor está ligado a localhost. No se ha publicado la demo ni ejecutado GitHub Actions en un remoto. No se afirma experiencia productiva con un ERP comercial.
