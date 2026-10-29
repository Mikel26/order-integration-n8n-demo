# Operación local y preparación de publicación

## Arranque y apagado

```sh
npm run setup:env
docker compose up -d --build --wait
docker compose ps
```

`migrate` y `n8n-init` deben terminar con código 0; API, ERP, n8n y PostgreSQL deben estar saludables. El worker debe permanecer activo. `docker compose stop` detiene servicios y conserva datos; `docker compose down` retira contenedores y red, conservando volúmenes. `docker compose down -v` **elimina las bases, las credenciales y las ejecuciones**: usar solo al descartar deliberadamente un entorno local.

Reiniciar desde la pantalla crea una sesión nueva, no elimina volúmenes.

## Diagnosticar una operación

1. Copiar su `operationId` del navegador y consultar `/api/operations/:id` con la misma cookie. Revisar eventos, estado, código y número de intentos.
2. Revisar `docker compose logs --tail 50 dispatcher ingress-api mock-erp` y las ejecuciones de n8n. Los logs de la aplicación no incluyen cookies ni secretos.
3. Si hay un recibo ERP y el callback se perdió, el worker publica el resultado. No cambiar stock manualmente ni reenviar con otro identificador para resolver una operación pendiente.
4. Si n8n está caído, restablecer el servicio. La concesión vence y se reintenta dentro del presupuesto. Al agotarlo, el dominio comprueba recibos y revoca el token antes de cerrar técnicamente.

El deadline es de 120 segundos mientras la infraestructura funciona. Durante una caída de PostgreSQL no se puede garantizar un cierre puntual: se resuelve al recuperarse. La UI no interpreta el timeout como rechazo.

## Reimportar workflows o rotar secretos internos

El bootstrap conserva ediciones mediante un marcador. Para reemplazar deliberadamente los workflows por los JSON del repositorio y actualizar credenciales desde `.env`:

```sh
docker compose stop dispatcher n8n
docker compose build n8n-init n8n
docker compose run --rm --no-deps -e FORCE_BOOTSTRAP=true n8n-init
docker compose up -d --no-deps n8n ingress-api mock-erp
# Cuando n8n y las APIs estén saludables:
docker compose up -d --no-deps dispatcher
```

Esto sobrescribe las ediciones de esos dos workflows y sus tres credenciales de demo. Exportar primero cualquier cambio que se quiera conservar. Los secretos nuevos deben estar en los servicios y en las credenciales de n8n al mismo tiempo. No rotar `N8N_ENCRYPTION_KEY` cambiando solo `.env`: requiere una migración específica de credenciales. Cambiar las contraseñas PostgreSQL en `.env` tampoco modifica roles de un volumen existente; hacerlo con administración de base y actualizar consumidores coordinadamente.

La importación por CLI puede ejecutarse sin el editor; necesita acceso administrativo a la base n8n. No exponer esa operación como endpoint público.

## Cuotas de uso

Valores iniciales: 5 creaciones/reinicios de sesión por IP/hora, 10 admisiones por sesión/minuto, 30 por IP/minuto, 60 lecturas por visitante/minuto, 2 operaciones pendientes por sesión y 10 globales. Máximo 100 sesiones retenidas y 1.000 operaciones retenidas. La limpieza se ejecuta cada minuto. El rechazo de cuotas no descarta trabajo activo.

Los tests en vivo crean sesiones y consumen estas cuotas. En un entorno desechable se puede recrear todo con volúmenes nuevos; no relajar controles de una demo compartida para repetir tests.

## Antes de publicar una live demo

- Elegir servidor o servicios de contenedores, almacenamiento persistente y presupuesto. Verificar condiciones de uso de la distribución n8n. No hay proveedor obligatorio.
- Configurar TLS, `PUBLIC_ORIGIN` exacto y `COOKIE_SECURE=true`. Configurar el editor n8n con acceso privado y su cookie segura si se accede por HTTPS.
- Mantener ERP, listener interno, PostgreSQL y editor fuera de Internet. Retirar los mapeos locales innecesarios. El único acceso del visitante es Angular y `/api`.
- Configurar `TRUSTED_PROXY_CIDR` con el proxy privado exacto y hacer que este reemplace cabeceras de IP. Si existe otro proxy delante de Nginx, definir explícitamente esa cadena y comprobar IP/cuotas reales; no confiar en todas las redes privadas.
- Añadir límite de cuerpo y presupuesto total de respuesta en el proxy público; el timeout del nodo n8n no garantiza un deadline de extremo a extremo.
- Comprobar persistencia, reinicios, recursos y retención. Conservar la clave de cifrado n8n fuera del repositorio y respaldar las bases según el presupuesto.
- Actualizar README con URL real, fecha de prueba y disponibilidad; conservar video/capturas si el servicio está suspendido. No presentar evidencia grabada como ejecución en vivo.

## Revisión antes de GitHub

`npm run format:check`, `npm run typecheck`, pruebas y `git diff --check`. Revisar que `.env`, cookies, credenciales exportadas e historial de ejecuciones no estén versionados. `npm run check:secrets` verifica que los secretos locales generados no estén en archivos preparados para Git.

El remoto `origin` apunta a `https://github.com/Mikel26/order-integration-n8n-demo.git`. Revisar la identidad de Git y utilizar la cuenta `Mikel26` al subir cambios. Elegir también la licencia que se quiere otorgar; no se ha añadido una licencia sin esa decisión.
