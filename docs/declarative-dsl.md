# DSL cerrado: una definición, tres intérpretes

Estado: diseño vigente; los helpers siguientes son ilustrativos, no APIs implementadas. Este documento sustituye las propuestas anteriores de handlers de aplicación y componentes con doble return. Se permiten callbacks puros de construcción con `ctx` tipado, pero no callbacks ejecutables en el manifiesto/runtime. Véase [contexto e inferencia](./context-and-inference.md).

## 1. Una app, un export

La app tiene una única raíz exportada. Sus definiciones pueden organizarse en módulos, pero solo pueden componer valores admitidos por el DSL.

```ts
export default app({
  tables,
  api,
  components,
  routes,
});
```

El compilador produce:

- Servidor: tablas, planes de lectura/escritura, codecs y runtime Effect v4.
- Cliente: árbol de componentes, acciones de interfaz y referencias públicas de API.
- Revisión: wireframe, variantes, grafo de navegación y relaciones API/tablas.

El navegador nunca importa la definición fuente completa. La separación se realiza por clases de nodos permitidas en cada artefacto, no confiando en tree-shaking para eliminar lógica de servidor. No se incluyen credenciales ni secretos en el contrato.

## 2. Tipos especializados

Los tipos internos son uniones cerradas, no objetos extensibles con callbacks:

| Tipo | Representa |
|---|---|
| TableDefinition | Campos, validadores e índices |
| QueryImplementation | Plan de lectura, resultado, errores y dependencias |
| ServerActionImplementation | Plan transaccional, resultado, errores, lecturas y escrituras |
| ComponentDefinition | Props, recursos, formularios, acciones y árbol de UI |
| UiNode | Elemento, composición, rama, colección, slot o feedback |
| ClientAction | Llamada al servidor, transición, cierre, reset o secuencia |
| RouteDefinition | Vista navegable, componente, parámetros, presentación y contexto |
| Expression | Literal, parámetro, campo, binding, resultado o transformación soportada |

Conceptualmente los builders propagan tipos como `QueryPlan<A, E, Reads>` y `WritePlan<A, E, Reads, Writes>`, pero también conservan schemas y metadatos en runtime. Los genéricos por sí solos no bastan para transportar errores ni exportar el contrato.

## 3. Objetos por dentro, builders por fuera

El desarrollador no escribe el AST verbose con `kind`, `where`, etc. Usa una sintaxis familiar que construye ese AST sin ejecutarlo.

```ts
const params = parameters({ done: schema.boolean() });

const list = query("todos.list", params).implement(
  db
    .select({ id: todos.id, title: todos.title, done: todos.done })
    .from(todos)
    .where(eq(todos.done, params.done))
    .orderBy(desc(todos.createdAt))
    .limit(50),
);
```

`params.done` es una referencia con codec y ámbito. No contiene el valor de una petición durante la definición. No se expone `.execute()`, SQL libre ni un callback `handler`. El runtime recibe los argumentos validados y ejecuta el plan cuando corresponde.

Las proyecciones explícitas evitan publicar automáticamente nuevos campos privados de una tabla. El schema de salida se deriva de la proyección.

## 4. Acciones de servidor

```ts
const params = parameters({ id: todos.idSchema });
const TodoNotFound = schema.error("TodoNotFound", { id: todos.idSchema });

const complete = action("todos.complete", params).implement(
  db
    .update(todos)
    .set({ done: true })
    .where(eq(todos.id, params.id))
    .requireAffected(TodoNotFound({ id: params.id }))
    .returningNoContent(),
);
```

Se infieren resultado `NoContent`, error `TodoNotFound` y escritura sobre `todos`. `requireAffected` falla si no existe una fila coincidente; no significa que el valor necesariamente haya cambiado. El adaptador debe mantener esa semántica también al asignar un valor ya existente.

- Una acción confirma datos o éxito sin contenido; no devuelve `null` como señal de fallo.
- Errores esperados son nodos con schema/tag; se combinan al componer planes.
- Lecturas, comprobaciones y escrituras de una acción se ejecutan en una transacción.
- Las queries pueden producir ausencia solo si su plan lo declara explícitamente; `orFail` la convierte en un error tipado.
- El conjunto de tablas leídas/escritas se obtiene del AST. No hace falta ejecutar una rama para descubrirlo.
- Tras commit se invalidan conservadoramente las queries activas cuyas lecturas intersecten las tablas afectadas.

La autoría no exige repetir `success` y `error`. El compilador genera un contrato equivalente a input/success/error y puede materializarlo con Effect HttpApi. Un schema de salida explícito queda como posibilidad para fijar fronteras públicas, no como requisito duplicado del CRUD.

## 5. Componentes: estilo Foldkit, sin su arquitectura

Usamos helpers de HTML/UI que devuelven nodos; no adoptamos Model/Message/update de Foldkit. Tampoco conservamos el doble return de Remix: la separación entre dependencias y presentación ya está en los datos.

```ts
const items = resource(list, { done: literal(false) });
const todo = itemBinding(items);
const open = transition.to(routes.detail);

const TodoList = component("TodoList", {
  queries: { items },
  actions: { open },

  body: ui.column([
    ui.heading("Tareas pendientes"),
    ui.query(items, {
      loading: ui.placeholder("Tareas"),
      error: {},
      success: ui.list(items.data, {
        item: todo,
        empty: ui.text("No hay tareas pendientes"),
        body: ui.row([
          ui.text(todo.title),
          ui.link("Abrir", open.with({ id: todo.id })),
        ]),
      }),
    }),
  ]),
});
```

Los nombres concretos de `resource` e `itemBinding` son provisionales. Su semántica no: binding tipado, identidad estable y ámbito restringido. `items.data` solo se puede usar bajo la rama de éxito; `todo` solo dentro de la plantilla de esa lista. La comprobación de ámbito puede requerir validación del AST además de tipos.

Componer `ui.component(Header, props)` inserta una referencia a otra definición, no llama código de render arbitrario. Las ramas de listas/queries conservan bindings y nodos. Un helper puede aceptar un callback de construcción tipado para producir esos nodos, pero nunca un handler opaco que se evalúe con datos reales en runtime.

Si TypeScript no infiere cómodamente propiedades hermanas, se permite un builder por etapas (`component().queries(...).actions(...).build(ctx => ...)`) que produce exactamente la misma definición cerrada. El constructor pasa un ctx local; `ctx.ctx` expone contexto heredado. Para una definición reutilizada, su contrato es la parte compatible común entre todos sus montajes, no el contexto del primer padre. El cálculo global y las limitaciones de TypeScript se especifican en [contexto e inferencia](./context-and-inference.md).

## 6. Formularios y acciones de interfaz

Los formularios derivan campos y validadores del input de una operación. Los valores iniciales se declaran: no todo schema permite inferirlos. Se distinguen valores de edición incompletos/invalidables y valores decodificados válidos para enviar. `.validate(draft)` vincula la llamada a ese paso de validación, no convierte todo borrador en input válido por una aserción de tipo.

```ts
const draft = form(api.todos.create.input, {
  initial: { title: "" },
});

const saveCall = call(api.todos.create)
  .with(draft.values)
  .validate(draft);

const save = saveCall.onSuccess(
  sequence(
    close.self(),
    transition.to(routes.detail).with({ id: saveCall.result.id }),
  ),
);

const clear = reset(draft);
```

`saveCall.result` solo es válido en la continuación de éxito de esa llamada. `sequence` ejecuta en orden y se detiene al fallar; cerrar + navegar se aplica como transición de navegación coherente, no mostrando necesariamente un frame intermedio. Una mutación ya confirmada no se revierte si luego falla la navegación.

Navegar siempre apunta a una ruta, no a un componente embebido. No hay `.asModal()`: la presentación pertenece al destino, definido una sola vez en el árbol de rutas.

Estado local permitido: borradores, validación, selección y otros estados de interacción expresados mediante primitivas soportadas. No stores arbitrarios de dominio ni setters libres. Un proveedor ancestro puede compartir esas capacidades mediante `ctx.ctx.ProjectDraft`; los hijos usan el mismo handle. Su identidad, duración y reconstrucción por rutas se detallan en [contexto e inferencia](./context-and-inference.md#8-lifted-state-y-ciclo-de-vida).

## 7. Cada error tiene representación

```ts
ui.actionFeedback(completeCall, {
  pending: ui.text("Guardando…"),
  error: {
    TodoNotFound: ui.notice("Esta tarea ya no existe"),
  },
});
```

- Tipos: el mapa cubre exhaustivamente los errores de negocio inferidos, sin tags inventados.
- Compilador: cada operación usada debe tener cobertura visual en todos los contextos relevantes, directamente o mediante una política compartida explícita.
- Un error puede mostrarse en un campo, aviso, región o modal. No es automáticamente otra ruta.
- Tratamientos compartidos son componentes reutilizables, no una excusa para ocultar errores del wireframe.
- Validación de inputs y fallos de transporte tienen políticas específicas del runtime; defectos inesperados se presentan de forma segura, sin filtrar detalles internos.
- Refetch con datos previos no equivale a carga inicial. Sus estados de actualización/fallo deben conservarse en el modelo y la exportación.

## 8. Inferencia y validación se complementan

Inferir: inputs, props, resultados, schemas, errores, dependencias, parámetros de rutas y capacidades de cada operador.

Validar además sobre el grafo: ámbitos, referencias sin resolver, ciclos de composición no soportados, errores sin feedback, rutas ambiguas, compatibilidad de codec URL, destinos no registrados, capacidades que cruzan la frontera cliente/servidor y límites del plan.

Referencias adelantadas entre rutas y componentes se resuelven mediante handles y construcción por etapas. Los callbacks puros de construcción pueden usarse para recibir ctx tipado, pero no ocultar destinos o proveedores detrás de lógica arbitraria. El manifiesto siempre conserva referencias explícitas. La sintaxis exacta se decidirá con un prototipo que pruebe tanto contexto inline como contexto común de componentes reutilizados.

## 9. Qué significa «sin lógica externa»

No se admiten handlers/closures de runtime, `fetch`, SQL libre, efectos arbitrarios, acceso a filesystem/env ni transformaciones opacas dentro del contrato. Las condiciones y transformaciones utilizan nodos soportados. Las constantes, composición de definiciones y callbacks puros de construcción con contexto simbólico tipado sí están permitidos. Estos últimos se evalúan durante compilación y desaparecen del manifiesto; el callback de construcción no es un callback de render con datos reales.

Un tipo TypeScript no impide `implementation: arbitraryFunction()`, casts, getters ni efectos durante imports. Por tanto:

1. Validador de autoría con imports/sintaxis permitidos antes de ejecutar módulos de definición.
2. Normalización del resultado a datos cerrados; sin funciones/getters ni prototipos ejecutables en el manifiesto.
3. Validación estricta del manifiesto y de las capacidades del destino.
4. Nunca ejecutar el archivo fuente en el navegador como sustituto del artefacto generado.

Esta disciplina no es un sandbox para código de terceros. Una futura plataforma necesita aislamiento adicional; el MVP compila apps del desarrollador en su propia cuenta.

## Referencias

- [Foldkit: descripción de vistas](https://foldkit.dev/core/view)
- [Effect HttpApi: ejemplo y contratos enlazados](https://github.com/Effect-TS/effect/blob/main/ai-docs/src/51_http-server/10_basics.ts)
- [Rutas y wireframe de este framework](./routing-and-wireframes.md)
- [Contexto heredado e inferencia](./context-and-inference.md)
- [Especificación resumida](../spec/README.md)
