# Progreso por fases

| Fase                      | Estado                 | Evidencia                                                           |
| ------------------------- | ---------------------- | ------------------------------------------------------------------- |
| 1. Contratos y estructura | Completada · `500e526` | Contratos, canonización y entorno Node                              |
| 2. Persistencia y ERP     | Completada · `74e15b3` | API, sesiones y transacciones PostgreSQL                            |
| 3. Despacho y n8n         | Completada · `3d01937` | A/B/C reales y recuperación mediante error handler                  |
| 4. Angular                | Completada · `d0d866f` | Interfaz, polling, 2 E2E y capturas revisadas                       |
| 5. Entrega y CI           | Verificada localmente  | Instalación limpia, 19 pruebas, smoke, recuperación y documentación |

Cada fase corresponde a un commit independiente. La quinta incorpora también separación de secretos por servicio, formato consistente y pruebas adicionales de rollback y cuotas.

El MVP corre localmente y el código está en [https://github.com/Mikel26/order-integration-n8n-demo](https://github.com/Mikel26/order-integration-n8n-demo), con el historial de fases conservado. La live demo pública sigue pendiente. Los pasos equivalentes del pipeline se verificaron localmente; las ejecuciones remotas se consultan en [GitHub Actions](https://github.com/Mikel26/order-integration-n8n-demo/actions/workflows/ci.yml).

Los diagramas de workflows documentan los JSON importables. Una captura adicional del canvas n8n requiere configurar su propietario local; no se presenta el diagrama como captura del editor. La licencia del repositorio queda pendiente de elección.

## Preparación de la live demo

- Proxy y configuración Vercel preparados: mensaje explícito cuando no hay backend y video de respaldo accesible.
- Backend con Compose independiente, HTTPS automático y servicios privados, validado localmente.
- Cuenta y VM Oracle Always Free pendientes del registro del titular; no se han creado recursos en la nube ni contratado servicios.
- Guía operativa: [LIVE-DEMO.md](LIVE-DEMO.md).

Frontend publicado y verificado: [https://order-integration-n8n-demo.vercel.app](https://order-integration-n8n-demo.vercel.app), en estado de preparación hasta conectar Oracle. Publicación inicial directa; integración GitHub de Vercel pendiente.
