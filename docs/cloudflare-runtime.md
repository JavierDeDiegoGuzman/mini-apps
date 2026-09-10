# Runtime Cloudflare: una app desplegable sin plataforma propia

Estado: arquitectura propuesta. No hay infraestructura desplegada.

## 1. Topología inicial

```text
Navegador
├── HTML/JS/CSS ──────────────────► Worker Static Assets
├── POST /api/query/:operation ──► Worker gateway
├── POST /api/mutation/:operation ► Worker gateway
└── GET /api/events (SSE) ────────► Worker gateway
                                          │ binding interno
                                          ▼
                                AppRuntime Durable Object
                                ├── intérprete Effect v4
                                ├── almacenamiento persistente
                                ├── versiones / epoch / recibos
                                ├── eventos / alarmas
                                └── conexiones activas
```

El Worker enruta; el Durable Object es la autoridad de datos y coordinación. Los assets se sirven sin pasar por el objeto. Las respuestas de queries no se cachean en CDN por defecto.

## 2. Identidad e aislamiento

MVP: **un Worker y su namespace por app/entorno; una instancia de datos dentro de ese namespace**.

```text
worker: todos-dev       objeto: app:todos:dev
worker: todos-prod      objeto: app:todos:prod
```

El gateway obtiene el objeto mediante un binding y un nombre estable configurado por despliegue. El navegador no elige nombres arbitrarios de objetos, apps ni namespaces.

No crear un objeto por conexión: los usuarios de una misma app deben compartir datos. Tampoco poner todas las apps en un único objeto. No usar el hash del build como nombre del objeto: cada deploy parecería perder los datos al apuntar a una instancia nueva.

Esto limita el tamaño y throughput de cada app a una instancia. Adecuado como objetivo para mini apps, no promesa de escalado ilimitado. Particionar por workspace/tenant es una ampliación futura; no habrá transacciones entre objetos en el MVP.

## 3. Persistencia

Propuesta para este adaptador: Durable Objects **SQLite-backed**, con su almacenamiento integrado y gestionado por Cloudflare. No requiere D1, Postgres ni un archivo SQLite que despliegue el usuario.

El lenguaje público mantiene `table`, `query` y `mutation` independientes del motor. SQLite aquí es una elección explícita de adaptador, no una imposición a toda la arquitectura.

Tablas internas reservadas:

- `_mini_schema_migrations`: versión, checksum y aplicación.
- `_mini_revisions`: versión por tabla de negocio.
- `_mini_metadata`: epoch e identificador del contrato compatible.
- `_mini_changes`: log de invalidaciones, cursor y entrega pendiente.
- `_mini_mutation_receipts`: clave de idempotencia, operación, hash del input y resultado.

Reservar el prefijo `_mini_` y prohibir acceso desde queries de negocio. Configurar retención y límites para recibos/log; no crecer indefinidamente.

Backups, exportación y restauración son distintos de desplegar código. La recuperación temporal del proveedor debe probarse y documentarse antes de prometer garantías de recuperación.

## 4. Protocolo HTTP y SSE

Ejemplo conceptual de consulta:

```json
{ "contractVersion": "todos-contract-3", "args": { "filter": "pending" } }
```

Respuesta:

```json
{
  "data": [],
  "epoch": "instance-epoch-a",
  "versions": { "todos": 12 },
  "contractVersion": "todos-contract-3"
}
```

Las versiones y los datos proceden del mismo snapshot. La identidad de caché incluye app/entorno, operación, argumentos canónicos y versión del contrato; se añadirá identidad de autorización cuando exista.

Evento SSE:

```text
id: 184
event: invalidate
data: {"epoch":"instance-epoch-a","tables":{"todos":13}}
```

Cada evento termina con una línea en blanco. El cursor SSE identifica el log; no es la versión de una tabla.

Al conectar, el servidor registra la conexión y envía un evento `hello` con epoch y versiones actuales sin una ventana que pueda perder cambios entre ambos pasos. Los resultados anteriores al watermark observado se vuelven a consultar.

- Si el epoch cambia, limpiar comparaciones previas y refrescar todo. Esto evita reutilizar versiones de una instancia reinicializada o restaurada.
- Reanudar por `Last-Event-ID` si el cursor sigue retenido.
- Cursor desconocido/expirado: evento `reset` y refetch de todas las queries activas.
- Una invalidación durante refetch queda pendiente hasta obtener esa versión o una posterior.
- Los eventos pueden duplicarse y agruparse por tabla tomando la versión máxima.
- Solo refetch de queries activas; las inactivas se marcan obsoletas para el próximo montaje.
- Mantener datos anteriores durante refetch; carga inicial solo cuando no hay resultado utilizable para esa entrada.

## 5. Entrega y recuperación

No basta con enviar SSE inmediatamente después de una escritura: el proceso puede morir entre commit y broadcast.

Guardar el evento dentro de la transacción. Programar un mecanismo durable de drenaje mediante alarmas, y hacer un intento de entrega inmediata tras commit. El adaptador debe demostrar mediante tests que no puede quedar un evento pendiente sin un futuro despertar programado. Si la primitiva de alarmas exige otra secuencia, diseñar el protocolo según sus garantías reales antes de implementarlo.

El drenaje es al menos una vez. No hay confirmación durable de consumo por cada navegador; una conexión perdida se recupera con cursor/watermark. Broadcast solo después de commit.

Un cliente lento no puede acumular memoria ilimitada: agrupar invalidaciones, limitar cola y cerrar la conexión si no avanza. La reconexión reconstruye el estado.

## 6. SSE frente a WebSockets

SSE sigue siendo la propuesta inicial por simplicidad: HTTP para operaciones y canal unidireccional para invalidaciones.

Pero una respuesta SSE larga mantiene trabajo/conexión activos y **no disfruta de la WebSocket Hibernation API**. No presupuestar el objeto como dormido mientras mantiene el stream. Heartbeats, timers y publicación también afectan a su actividad y coste.

Cloudflare ofrece WebSockets con hibernación: los sockets permanecen conectados mientras el objeto sale de memoria. Es una evolución atractiva para este destino, no una decisión ya tomada de sustituir SSE.

Mantener el protocolo de mensajes desacoplado:

```text
hello / invalidate / reset
          │
          ├── SSE: MVP
          └── WebSocket hibernable: opción posterior
```

Al usar hibernación habría que reconstruir recursos y recuperar metadatos de sockets mediante attachments. No mantener un runtime Effect ni un mapa JS de suscriptores como única fuente de información. Probar duración/coste real del prototipo SSE antes de recomendarlo para producción.

## 7. Mutaciones e idempotencia

El SDK crea una clave de invocación por intención de mutación. Reintentos de esa misma intención usan la misma clave. Dentro de la transacción:

1. Consultar recibo existente.
2. Si coincide operación e input, devolver resultado previo sin repetir la escritura.
3. Si la clave se reutiliza con otro payload, devolver conflicto.
4. Ejecutar plan, actualizar versiones y registrar recibo/evento.

La garantía está acotada por la retención anunciada del recibo. No reintentar silenciosamente una invocación antigua una vez expirado ese periodo. Esto mejora el ejemplo 03, que dejaba `create` sin reintento seguro.

## 8. Migraciones y compatibilidad

Dos sistemas diferentes:

- **Migraciones Wrangler:** clases/namespaces de Durable Objects (`new_sqlite_classes`, cambios de clases).
- **Migraciones de la app:** tablas, columnas, índices y transformaciones de datos dentro del objeto.

No confundirlos. El framework genera un plan de schema revisable; no borra columnas/tablas automáticamente. Migraciones cortas pueden ejecutarse con exclusión durante inicialización; migraciones grandes requieren protocolo de mantenimiento por fases, fuera del MVP.

Cada petición lleva versión de contrato. El servidor acepta un rango explícito o responde `UnsupportedContract`; el cliente pide recarga sin repetir mutaciones automáticamente. Un nuevo bundle no garantiza que desaparezcan pestañas antiguas.

Revertir el Worker **no revierte los datos**. Favorecer migraciones compatibles expand/contract y bloquear rollback incompatible.

## 9. Operación sin control plane

El usuario despliega en su propia cuenta Cloudflare usando Wrangler. No almacenamos sus credenciales en una plataforma nuestra.

Inicialmente se necesitan: health del gateway, readiness del objeto/schema, logs, exportación de datos y un mecanismo administrativo protegido para migraciones. Ninguna ruta administrativa debe quedar pública porque la autenticación de negocio esté aplazada.

## Fuentes

- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Primer Worker + Durable Object](https://developers.cloudflare.com/durable-objects/get-started/)
- [Storage SQL](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Hibernación WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Alarmas](https://developers.cloudflare.com/durable-objects/api/alarms/)
