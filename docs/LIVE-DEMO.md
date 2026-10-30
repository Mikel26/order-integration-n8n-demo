# Live demo con presupuesto de hosting de $0

Topología elegida: Angular y un proxy mínimo en Vercel Hobby; APIs, worker, n8n y PostgreSQL en una VM Oracle Cloud Always Free. DNS gratuito para el backend, por ejemplo DuckDNS. No se activa un plan de pago ni se compran dominios.

El despliegue completo requiere una cuenta Oracle ya verificada y una VM disponible. Publicar el frontend antes deja una web accesible con un mensaje de preparación; no la convierte en una integración operativa. El video de GitHub sigue disponible como respaldo.

## Estado actual

Web pública: [https://order-integration-n8n-demo.vercel.app](https://order-integration-n8n-demo.vercel.app). Verificada sin autenticación: HTTP 200, API `503 DEMO_OFFLINE`, mensaje de preparación visible y ningún error JavaScript. El backend Oracle sigue pendiente del registro del titular. La primera publicación fue directa; la actualización automática por GitHub requiere autorizar la integración para este repositorio.

## 1. Vercel Hobby

Importar `Mikel26/order-integration-n8n-demo` en el espacio personal autorizado. Si la integración GitHub todavía no tiene acceso al repositorio, se puede hacer una primera publicación directa del código; la actualización automática por push requiere autorizar después ese repositorio en la integración GitHub de Vercel. Mantener la raíz del repositorio (`.`), porque Angular comparte contratos fuera de `apps/web`.

| Ajuste    | Valor               |
| --------- | ------------------- |
| Framework | Angular             |
| Node      | 24.x                |
| Install   | `npm ci`            |
| Build     | `npm run build:web` |
| Output    | `dist/web/browser`  |

`vercel.json` incluye estos ajustes y dirige `/api/*` a `api/gateway.ts`. La función solo acepta las rutas públicas, conserva cookies/Origin/Idempotency-Key y exige HTTPS para el backend. No ejecuta n8n, no accede a PostgreSQL y no contiene credenciales ERP. No hay daemons ni cron jobs en Vercel.

Por ahora se puede dejar `DEMO_BACKEND_ORIGIN` sin definir: la API responde `503 DEMO_OFFLINE` con una explicación visible, sin simular pedidos. Cuando exista el backend, configurar **solo en Vercel Production**:

```text
DEMO_BACKEND_ORIGIN=https://NOMBRE-REAL-DEL-BACKEND.duckdns.org
```

Usar el origen sin rutas, parámetros ni credenciales. Después redeplegar. Las vistas previas no se conectan automáticamente a producción: el backend comprueba el Origin exacto. No copiar `.env` ni `.env.live` a Vercel; su única variable necesaria es la URL del backend.

La URL canónica de producción `https://order-integration-n8n-demo.vercel.app` es el `PUBLIC_ORIGIN` del backend. No usar una URL temporal de commit que cambie al desplegar.

## 2. Cuenta e instancia Oracle Always Free

El titular completa el registro, teléfono y verificación de tarjeta. Mantener la cuenta gratuita y seleccionar únicamente recursos con elegibilidad Always Free; los créditos temporales de la prueba no son el presupuesto de esta demo.

En la región principal elegida:

1. Buscar una VM ARM `VM.Standard.A1.Flex` dentro de la cuota Always Free que muestre la consola. Como punto inicial para evaluar, 2 OCPU y 8 GB RAM; confirmar elegibilidad y consumo acumulado de la cuenta antes de crear.
2. Usar un volumen de arranque dentro de la cuota gratuita, por ejemplo 50 GB, considerando los demás volúmenes de la cuenta.
3. Comprobar que el resumen de creación no incluya recursos de pago. Si no hay capacidad gratuita, esperar o revisar otra disponibilidad de esa región; no cambiar a una forma de pago para continuar.
4. Crear/acceder mediante una clave SSH. Mantener SSH limitado a tu IP y habilitar TCP 80/443 para el proxy HTTPS en la red y firewall del sistema operativo.
5. Instalar Docker Engine y Compose v2 según las instrucciones oficiales de la distribución. No se necesita Docker Desktop en la VM.

La documentación consultada el 30 de octubre de 2026 indica 2 OCPU/12 GB como equivalencia mensual Always Free para A1, y 200 GB de almacenamiento de bloque compartido. Estas cuotas pueden cambiar y hay que verificar el resumen actual de la consola. La capacidad no está garantizada y Oracle puede recuperar instancias inactivas. No se generan cargas artificiales para impedir esa recuperación.

[Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) · [Registro y condiciones](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)

## 3. DNS y secretos

Crear un nombre gratuito en [DuckDNS](https://www.duckdns.org/) y apuntarlo a la IP pública de la VM. El titular administra el token DNS; no se guarda en este repositorio. Si la IP cambia, actualizar el registro.

En un equipo con Node 24, generar una configuración nueva con los valores reales:

```sh
npm run setup:live --   --frontend https://order-integration-n8n-demo.vercel.app   --api-host NOMBRE-REAL-DEL-BACKEND.duckdns.org
```

El comando crea `.env.live` con permisos `0600`, secretos aleatorios y el origen HTTPS. Si ya existe, se detiene para no rotar contraseñas accidentalmente. El archivo está ignorado por Git y Vercel. Transferirlo mediante SCP/SSH a la raíz del repositorio en la VM, conservarlo como `0600` y guardar una copia privada de recuperación.

No usar los valores ilustrativos de este documento como URLs funcionales. No enviar secretos por el chat.

## 4. Arranque en la VM

```sh
git clone https://github.com/Mikel26/order-integration-n8n-demo.git
cd order-integration-n8n-demo
# Transferir .env.live a este directorio mediante SSH antes del siguiente comando.
chmod 600 .env.live
docker compose --env-file .env.live -f deploy/compose.live.yaml config --quiet
docker compose --env-file .env.live -f deploy/compose.live.yaml up -d --build --wait
```

Este archivo es **independiente** del Compose local, para no heredar sus puertos de desarrollo. Solo Caddy publica 80/443; el editor n8n conserva un puerto ligado a `127.0.0.1` para administración por SSH. PostgreSQL, ERP y el listener interno no publican puertos. Los volúmenes mantienen bases, credenciales y certificados.

Caddy obtiene/renueva certificados cuando el DNS apunta correctamente y 80/443 son accesibles. Su IP Docker está fijada a `172.30.240.2` (la API usa `172.30.240.3`), el único proxy confiable para la API. Si esa subred ya está ocupada, cambiar subnet, IP y `TRUSTED_PROXY_CIDR` de forma coordinada antes de arrancar. El proxy reemplaza X-Forwarded-For. En la ruta vía Vercel, la cuota por IP agrupa solicitudes del proxy de Vercel; el aislamiento por sesión y los límites globales siguen aplicándose.

No se recomienda ejecutar `docker compose down -v`: elimina datos persistidos. Tampoco se debe regenerar `.env.live` al actualizar imágenes: las contraseñas y la clave de cifrado deben conservarse.

Para administrar el editor n8n desde el equipo local:

```sh
ssh -L 5678:127.0.0.1:5678 USUARIO@IP_DE_LA_VM
```

Configurar el propietario local del editor y mantenerlo fuera del acceso público.

## 5. Conectar y validar

1. Verificar `https://NOMBRE-REAL-DEL-BACKEND.duckdns.org/health` y el certificado.
2. Configurar `DEMO_BACKEND_ORIGIN` en Vercel Production y redeplegar.
3. Abrir la URL pública en una ventana nueva; probar válido, insuficiente y duplicado. Verificar stock `3/2/2`, un solo pedido confirmado y cookies Secure/HttpOnly/SameSite.
4. Ejecutar, con Node 24, el smoke público:

```sh
DEMO_API_URL=https://order-integration-n8n-demo.vercel.app PUBLIC_ORIGIN=https://order-integration-n8n-demo.vercel.app npm run test:smoke
```

5. Verificar la denegación de `/internal/*` en el backend y probar otra sesión de navegador para comprobar su stock privado. No detener el ERP de una demo compartida para ejecutar pruebas destructivas.
6. Añadir al README la URL de la **live demo completa** solo cuando termine este recorrido.

## Recuperación y reversión

Si falla la conexión de Vercel, retirar temporalmente `DEMO_BACKEND_ORIGIN` y redeplegar: vuelve al estado de preparación sin resultados ficticios. Si falla una versión del backend, volver a la revisión Git anterior y reconstruir los servicios conservando `.env.live` y volúmenes. No revertir una migración de datos sin revisar su compatibilidad; este despliegue no cambia el esquema.

Antes de cada actualización: CI verde, copia privada de configuración y bases, validación de Compose y revisión de diferencias. Después: health y A/B/C, logs de errores y prueba desde otro navegador. Si falla un escenario de integridad, revertir el código y deshabilitar temporalmente el proxy público.

Referencias: [Vercel Node.js](https://vercel.com/docs/functions/runtimes/node-js), [rewrites](https://vercel.com/docs/rewrites), [HTTPS de Caddy](https://caddyserver.com/docs/automatic-https).
