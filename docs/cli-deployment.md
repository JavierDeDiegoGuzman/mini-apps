# CLI y despliegue directo en Cloudflare

Estado: especificación de comandos futuros. **`mini` no existe todavía.** No ejecutar estos ejemplos esperando un despliegue funcional del repositorio actual.

## 1. Experiencia deseada

```sh
mini new my-todos --template todos
cd my-todos
mini dev
mini check
mini wireframe export --out ./review
mini deploy cloudflare --env staging
mini logs --env staging
```

Objetivo: pasar de contrato a app desplegada en la cuenta Cloudflare del desarrollador, sin panel de plataforma propio. La entrada de compilación es un único export de aplicación que reúne DSL y árbol de rutas/vistas; véanse [DSL cerrado](./declarative-dsl.md) y [routing](./routing-and-wireframes.md).

`mini deploy` delega la autenticación y publicación a Wrangler. No implementa una segunda API de despliegue ni almacena tokens por su cuenta.

## 2. Estructura de una app

```text
my-todos/
├── app.config.ts
├── app.ts              # único export raíz; referencia definiciones de los módulos
├── client/
│   └── app.ts
├── server/
│   ├── tables.ts
│   └── todos.ts
├── shared/
│   └── inputs.ts
├── migrations/
│   └── 0001-initial.json
├── deploy/
│   └── cloudflare/
│       ├── staging.wrangler.jsonc
│       └── production.wrangler.jsonc
├── generated/
│   └── api.ts
└── .mini/
    ├── cloudflare/worker.ts
    ├── public/
    ├── manifest.json
    └── wireframe.json
```

Código, configuración estable e historial de migraciones se versionan. `.mini` y la caché local se regeneran. Secrets y tokens nunca se incluyen en los artefactos ni el wireframe.

## 3. Configuración propia propuesta

```ts
export default defineAppConfig({
  id: "my-todos",
  entry: "./app.ts",
  deploy: {
    provider: "cloudflare",
    isolation: "app",
    reactivity: "sse",
  },
});
```

No elegir un archivo SQLite aquí. El adaptador Cloudflare define cómo materializar tablas sobre el storage de Durable Objects.

## 4. Contrato de comandos

| Comando propuesto | Comportamiento |
|---|---|
| `mini new` | Crear plantilla y dependencias fijadas |
| `mini check` | Tipos, callbacks de construcción/imports permitidos, AST sin funciones, ámbitos, contexto común por definición/montajes, errores con feedback, rutas/URLs, fronteras cliente-servidor, índices y schema |
| `mini generate` | Referencias tipadas y manifiesto serializable; tipos de contexto común si el prototipo elige generación (no asumir que ya existe) |
| `mini dev` | Build/watch + Wrangler local; sin tocar datos remotos |
| `mini build --target cloudflare` | Assets, Worker, export de clase DO y manifiesto |
| `mini wireframe export` | Láminas, conexiones y grafo opcional API/tablas; sin backend real |
| `mini deploy cloudflare --env staging --dry-run` | Build y validación de bundle/config; mostrar recursos y migraciones previstos |
| `mini deploy cloudflare --env staging` | Validar, planificar, confirmar y publicar usando Wrangler |
| `mini logs --env staging` | Delegar a Wrangler tail |
| `mini db migration plan` | Diff revisable contra schema versionado, sin escribir |
| `mini db migration apply --env staging` | Aplicar mediante canal administrativo protegido |
| `mini db export --env staging --out backup.json` | Exportación consistente y versionada, autenticada |

`--dry-run` no promete ejecutar o validar todas las operaciones contra la cuenta remota. Debe distinguir validación local de comprobaciones remotas de permisos/recursos.

No incluir `destroy` ni reset remoto en el primer CLI. Reset local exige confirmación e indica exactamente qué directorio elimina.

## 5. Wrangler generado

Ejemplo de configuración **para cuando exista el Worker generado**, ubicada en `deploy/cloudflare/staging.wrangler.jsonc`. Las rutas se resuelven desde ese archivo:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "my-todos-staging",
  "main": "../../.mini/cloudflare/worker.ts",
  "compatibility_date": "2026-01-01",
  "workers_dev": false,
  "assets": {
    "directory": "../../.mini/public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/_mini/*"]
  },
  "durable_objects": {
    "bindings": [
      { "name": "APP_RUNTIME", "class_name": "AppRuntime" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["AppRuntime"] }
  ],
  "vars": {
    "MINI_APP_ID": "my-todos",
    "MINI_ENV": "staging"
  }
}
```

La fecha de compatibilidad es ilustrativa: el generador fija una fecha comprobada con sus tests, no la cambia silenciosamente en cada deploy. Ajustar flags solo si el bundle los necesita; no presuponer compatibilidad Node completa.

`workers_dev: false` evita dar por hecho que la API sin auth de negocio debe estar pública. Para acceder a staging se debe configurar una ruta/dominio protegido con Access y sus permisos antes del smoke test remoto. El CLI debe comprobar/advertir de esta precondición; esta configuración sola no crea un dominio ni una política Access.

Production tendrá archivo propio, nombre distinto y binding no compartido con staging. El generador mantiene el historial de migraciones de clases: nunca regenerar tags incompatibles o renombrar `AppRuntime` sin plan explícito.

## 6. Comandos reales subyacentes

Después de implementar/generar los artefactos, el adaptador usaría comandos existentes de Wrangler, fijado como dependencia de desarrollo:

```sh
# Login interactivo local; en CI usar credenciales con permisos mínimos.
pnpm exec wrangler login

# Desarrollo local; directorio persistente solo para datos de desarrollo.
pnpm exec wrangler dev \
  --config deploy/cloudflare/staging.wrangler.jsonc \
  --persist-to .mini/local-state

# Validar el bundle sin publicar.
pnpm exec wrangler deploy \
  --config deploy/cloudflare/staging.wrangler.jsonc \
  --dry-run

# Publicar.
pnpm exec wrangler deploy \
  --config deploy/cloudflare/staging.wrangler.jsonc

# Inspeccionar logs remotos.
pnpm exec wrangler tail \
  --config deploy/cloudflare/staging.wrangler.jsonc
```

El entorno local usa la emulación de Workers/Durable Objects de Wrangler. No es prueba suficiente de límites, coste, latencia, SSE o ciclo de vida real: hace falta smoke test remoto.

## 7. Secuencia segura de deploy

1. Validar tipos/DSL y ejecutar tests.
2. Generar manifiesto con versión de formato y hash de contrato; no cambiar identidad del objeto.
3. Construir cliente y Worker sin incluir código servidor en assets.
4. Mostrar cuenta, Worker, entorno, objeto objetivo y política de acceso.
5. Revisar migraciones; rechazar cambios destructivos no aprobados.
6. Publicar bundle/config mediante Wrangler.
7. Inicializar/aplicar migraciones compatibles usando el procedimiento protegido del runtime.
8. Comprobar readiness y compatibilidad de contrato.
9. Probar query, escritura controlada, persistencia y dos conexiones reactivas.
10. Mostrar URL accesible y artefacto de wireframe de esa versión.

No prometer atomicidad entre publicación de assets, código y migración de datos. El protocolo debe tolerar clientes antiguos y una ventana de inicialización con respuesta temporal de mantenimiento. Un deploy fallido no provoca borrado de datos ni rollback automático del schema.

## 8. Hitos de implementación

### A. Núcleo sin cloud

AST, schemas, inferencia de dependencias, compilador SQL y tests de contratos. Prototipar el constructor de árbol con `ctx.ctx`, montajes múltiples y contexto común: documentar qué comprueba TypeScript y qué exige `mini check` o generación. Validar callbacks de construcción sin funciones en el AST final. Interpretar el todo list con un adaptador de prueba.

### B. Vertical mínimo en Workers local

Un Worker, un DO, tabla todos, query, inserción y actualización. Effect v4 en la frontera de ejecución. Validar cliente SQL existente o adaptador directo de SQL síncrono.

### C. Reactividad correcta

Versiones/snapshots, SSE, carreras de inicialización, reconexión, backpressure, log durable, alarmas e idempotencia.

### D. Deploy repetible

Generación Wrangler, staging protegido, migración inicial, segundo deploy sin perder datos y smoke test con dos clientes.

### E. Integración con UI y exportador

SDK de queries/acciones, migración de los casos funcionales del ejemplo 03 a builders cerrados con callbacks solo de construcción y árbol de rutas=vistas. Proveedores compartidos, lifted state, contexto común por montaje y entrada directa a subrutas. Generar el wireframe del mismo contrato. Probar que botones, continuaciones, errores, layouts, fondos canónicos de modales, dependencias de contexto y relaciones API/tablas aparecen sin anotaciones paralelas.

No empezar con panel multiusuario, facturación ni orquestación de miles de apps.

## Fuentes

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Configuración Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Inicio con Durable Objects](https://developers.cloudflare.com/durable-objects/get-started/)
- [Assets SPA](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
