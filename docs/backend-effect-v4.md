# Backend declarativo y runtime Effect v4

Estado: diseño. No hay paquete ejecutable ni imports propios estabilizados.

## 1. Separar lenguaje e intérprete

```text
Schema de tablas + expresiones de queries + planes de mutaciones
                              │
                              ▼
                    Compilador del contrato
                    ├── validadores y tipos
                    ├── manifiesto serializable
                    ├── dependencias de tablas
                    ├── referencias públicas de API
                    └── planes ejecutables
                              │
                              ▼
                      Runtime Effect v4
                              │
                 Adaptador de almacenamiento/host
```

La app no proporciona handlers ni callbacks de implementación, SQL o Effects arbitrarios. Usa builders que producen `QueryImplementation` y `ServerActionImplementation` cerrados, con referencias simbólicas tipadas. No acceden a red, secretos, reloj ni datos reales durante la construcción. Véase [el DSL vigente](./declarative-dsl.md).

Effect implementa la ejecución, validación, errores, servicios, recursos y observabilidad. No es una nueva obligación sintáctica para cada autor de aplicaciones.

## 2. Ejemplo de contrato público

```ts
const todos = table("todos", {
  title: schema.string().minLength(1),
  done: schema.boolean(),
}).index("by_done_created", ["done", "createdAt"]);

const params = parameters({ id: todos.idSchema });
const TodoNotFound = schema.error("TodoNotFound", { id: todos.idSchema });

const api = defineApi({
  pending: query("todos.pending", parameters({})).implement(
    db.select({ id: todos.id, title: todos.title })
      .from(todos)
      .where(eq(todos.done, literal(false)))
      .orderBy(desc(todos.createdAt))
      .limit(50),
  ),

  complete: action("todos.complete", params).implement(
    db.update(todos)
      .set({ done: true })
      .where(eq(todos.id, params.id))
      .requireAffected(TodoNotFound({ id: params.id }))
      .returningNoContent(),
  ),
});
```

`action` designa aquí una mutación transaccional del servidor; se diferencia de `ClientAction`, el plan de interacción. Éxito y errores no se declaran otra vez: sus schemas se derivan de proyecciones y nodos de fallo. Una acción devuelve datos o `NoContent`, no null como fallo. El frontend debe representar exhaustivamente los errores de negocio inferidos.

Los schemas públicos se compilan a validadores Effect Schema y metadatos exportables. Los detalles internos de Schema no deben determinar el formato de manifiesto. Validar siempre en servidor, aunque el frontend comparta el schema.

## 3. Representación intermedia

Ejemplo reducido:

```json
{
  "id": "todos.pending",
  "kind": "query",
  "plan": {
    "kind": "select",
    "table": "todos",
    "where": { "field": "done", "operator": "eq", "value": false },
    "order": [{ "field": "createdAt", "direction": "desc" }],
    "limit": 50
  },
  "reads": ["todos"]
}
```

El manifiesto incluye versión de formato, schemas de entrada/salida, errores conocidos, planes y conjuntos de lecturas/escrituras. No incluye secretos, credenciales ni closures.

Reglas iniciales:

- Identificadores de operaciones estables y explícitos; nunca derivados del texto de una función.
- SQL parametrizado; tablas, columnas y operadores vienen del contrato, no de strings arbitrarios del cliente.
- Orden determinista: añadir `id` como desempate si falta.
- Límites de resultados y costes de consulta; no permitir scans ilimitados por defecto.
- `get(id)` produce fila o null; ordenar/filtrar colecciones son operaciones distintas.
- Uniones declarativas como `db.match` aportan todas sus dependencias posibles.
- No SQL enviado desde el cliente. Solo operación registrada + argumentos validados.
- Queries: solo lectura. Mutaciones: plan transaccional, sin llamadas externas.

## 4. Servicios internos en Effect

Contratos conceptuales, no firmas definitivas:

| Servicio | Responsabilidad |
|---|---|
| AppContract | Resolver operaciones y schema por versión |
| QueryExecutor | Validar argumentos, ejecutar lectura y devolver datos + versiones |
| MutationExecutor | Validar, ejecutar escritura y confirmar commit |
| Storage | Capacidades de snapshot, transacción y acceso a tablas |
| RevisionStore | Versiones por tabla y epoch de la instancia |
| MutationReceipts | Idempotencia y resultados confirmados |
| ChangeLog | Eventos persistidos y replay acotado |
| LiveConnections | Entrega best-effort de invalidaciones |
| MigrationRunner | Verificar/aplicar migraciones ordenadas |
| Telemetry | Logs estructurados, spans y métricas |

Los servicios se suministran mediante Layers. Las pruebas pueden sustituir almacenamiento, reloj y conexiones sin conectar a Cloudflare. No introducir un contenedor global mutable que mezcle apps o entornos.

La referencia v4 consultada se identifica como **v4 (rc)** y lista `@effect/sql-sqlite-do`. Antes de implementar, fijar una versión exacta disponible y validar ese adaptador contra Durable Objects. No mezclar ejemplos v3 con v4 ni asumir APIs estabilizadas de módulos `unstable`.

## 5. Transacción y límites de Effect

Una escritura lógica debe confirmar atómicamente:

1. Cambios de negocio.
2. Incrementos de versión de las tablas afectadas.
3. Recibo de idempotencia, si procede.
4. Evento de invalidación persistido.
5. Programación durable de entrega/reintento, según garantías del adaptador.

En Durable Objects, la API SQL es síncrona. El adaptador puede ejecutar el plan completo dentro de `transactionSync`, sin `await`, fetch ni interrupciones entre sentencias, y envolver la operación en Effect desde fuera. No convertir una transacción síncrona en varias operaciones asíncronas sin demostrar que conserva atomicidad.

Effect aporta composición y manejo de fallos; no sustituye las garantías transaccionales del almacenamiento ni vuelve durable una Fiber.

## 6. Ciclo de vida

- Cada petición tiene un Scope para recursos temporales, timeout y cancelación.
- Una conexión SSE necesita un Scope que sobreviva a la devolución del `Response`, hasta cierre/error/cancelación del body. No cerrarlo al terminar el handler HTTP.
- En desconexión, liberar suscripción, timers y colas del cliente.
- Configuración y planes compilados pueden reutilizarse por instancia mientras permanezca viva.
- Estado importante nunca exclusivamente en memoria: el host puede reiniciar o hibernar el objeto.
- No depender de Fibers daemon, intervalos perpetuos ni `waitUntil` como cola durable.
- Alarms/outbox se usan para trabajo que debe continuar tras reinicios.
- Cancelar una petición tras commit no deshace la mutación: el cliente debe poder recuperar su recibo.

## 7. Errores y seguridad mínima

Separar errores de negocio tipados (p. ej. `TodoNotFound`, declarado mediante schema y requerido por el plan) de errores del runtime/protocolo (`InvalidInput`, `Conflict`, `UnsupportedContract`, `StorageUnavailable`, `LimitExceeded`, `UnknownOperation`). Los primeros requieren tratamiento visual exhaustivo por operación; los segundos tienen políticas comunes explícitas y exportables.

Separar estos errores esperados de defectos internos. Respuestas públicas no exponen SQL, stacks ni secretos. Registrar requestId, operationId, app/entorno y versión de contrato; no volcar formularios completos por defecto.

Sin autenticación de negocio aún, pero el adaptador HTTP debe tener límites de body, límites de conexiones, rate limits, validación de Origin, políticas CORS cerradas y protección de rutas administrativas. Origin/CORS no son autenticación: hasta implementarla, las demos remotas deben estar detrás de Cloudflare Access u otra barrera real.

## 8. Contrato de portabilidad

Un backend alternativo necesita implementar snapshot de lectura, transacción atómica, versiones persistidas, registro de cambios y recuperación tras desconexión. Si no puede cumplir esas garantías, no es un adaptador equivalente.

No se abstrae prematuramente cada servicio del proveedor: SQL de Durable Objects, alarmas y conexiones viven en el adaptador; AST, validación, dependencias y wireframe permanecen independientes.

## 9. Pruebas previas al MVP

- Inferencia estática de input/resultados e incompatibilidades de campos.
- Snapshot coherente de resultados y versiones.
- Fallo intermedio: rollback de datos, versiones y recibo.
- Idempotencia: misma clave + mismo payload devuelve resultado previo; distinto payload produce conflicto.
- Interrupción antes/después de commit.
- Reinicio del objeto con cambios aún sin publicar.
- Desconexión SSE sin fugas de recursos.
- SQL malicioso en valores sigue siendo un parámetro, no código.

## Fuentes

- [Referencia oficial Effect v4](https://effect.website/docs/v4/api)
- [Anuncio beta v4: contexto de migración y módulos inestables](https://effect.website/blog/releases/effect/40-beta)
- [SQL y transacciones de Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
