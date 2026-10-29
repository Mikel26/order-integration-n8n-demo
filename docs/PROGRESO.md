# Progreso por fases

| Fase                      | Estado                 | Evidencia                                                           |
| ------------------------- | ---------------------- | ------------------------------------------------------------------- |
| 1. Contratos y estructura | Completada · `500e526` | Contratos, canonización y entorno Node                              |
| 2. Persistencia y ERP     | Completada · `74e15b3` | API, sesiones y transacciones PostgreSQL                            |
| 3. Despacho y n8n         | Completada · `3d01937` | A/B/C reales y recuperación mediante error handler                  |
| 4. Angular                | Completada · `d0d866f` | Interfaz, polling, 2 E2E y capturas revisadas                       |
| 5. Entrega y CI           | Verificada localmente  | Instalación limpia, 19 pruebas, smoke, recuperación y documentación |

Cada fase corresponde a un commit independiente. La quinta incorpora también separación de secretos por servicio, formato consistente y pruebas adicionales de rollback y cuotas.

El MVP corre localmente; la creación del remoto GitHub y la live demo pública siguen pendientes. El pipeline de CI está preparado y sus pasos equivalentes se ejecutaron localmente; aún no existe una ejecución remota para mostrar como evidencia.

Los diagramas de workflows documentan los JSON importables. Una captura adicional del canvas n8n requiere configurar su propietario local; no se presenta el diagrama como captura del editor. La licencia del repositorio queda pendiente de elección.
