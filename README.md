# Order Integration · n8n demo

Proyecto de portafolio de **Mikel Ortega**: pedidos ficticios desde Angular, integración asíncrona con n8n y ERP simulado en Node.js/TypeScript + PostgreSQL.

## Desarrollo por fases

1. Estructura, contratos y entorno reproducible.
2. Persistencia, API y ERP transaccional.
3. Despacho duradero y workflows n8n.
4. Interfaz Angular de una pantalla.
5. Pruebas de integración y documentación de operación.

Cada fase tiene su propio commit y verificaciones. La [especificación](docs/ESPECIFICACION.md) define el alcance. Este proyecto usa datos sintéticos y no integra un ERP comercial.

Requisitos: Node 24 (ver `.nvmrc`) y Docker Compose. Preparación: `npm ci`, `npm run setup:env`. Las instrucciones de ejecución se incorporan con las fases siguientes.
