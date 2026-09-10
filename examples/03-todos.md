# Ejemplo 3 · Todos: componentes, acciones y persistencia

**Propuesta de API, no ejecutable.** Los helpers no están implementados. Este documento une frontend, backend declarativo, persistencia y wireframe esperado. No incluye autenticación: sería una demo privada, no una app lista para exponer públicamente.

## 1. Qué permite hacer

| Interacción | Tipo de acción | Persistencia |
|---|---|---|
| Cambiar Todos / Pendientes / Hechos | Front: transición con parámetros | No escribe en DB |
| Escribir o limpiar un formulario | Front: borrador gestionado | Solo memoria mientras esté abierto |
| Abrir / cancelar modal | Front: transición / cierre | No escribe en DB |
| Crear tarea | Back + front: insertar, cerrar, abrir detalle | SQLite |
| Completar / reabrir tarea | Back: actualización | SQLite |
| Pedir confirmación para eliminar | Front: abrir modal | No escribe en DB |
| Confirmar eliminación | Back + front: borrar, cerrar, volver a lista | SQLite |
| Reintentar una query | Front/runtime: volver a consultar | No escribe en DB |

Los datos de dominio viven en el servidor. Los resultados de queries son una caché gestionada, no otra fuente de verdad. Los borradores de formularios son estado local deliberado y se descartan al cerrar.

## 2. Tablas y almacenamiento

```ts
const tables = defineTables({
  todos: table({
    title: schema.string().trim().minLength(1).maxLength(120),
    notes: schema.string().maxLength(2000),
    done: schema.boolean(),
  }).index("by_done_created", ["done", "createdAt"]),
});

const db = database(tables);

const server = defineServer({
  database: db,
  storage: sqlite({ file: "./data/todos.sqlite" }),
  api: { todos },
  reactivity: {
    transport: "sse",
    invalidation: "table",
  },
});
```

`id: Id<"todos">` y `createdAt: number` son campos automáticos. El servidor asigna ambos al insertar. Existe un índice de creación por defecto; el índice compuesto soporta filtro por `done` y orden por fecha.

SQLite es una elección de este ejemplo. Reiniciar el servidor o recargar el navegador conserva las tareas. Se necesitan volumen persistente y copias de seguridad para no perder el archivo al redesplegar. La evolución del schema requiere migraciones; no se presupone que cambiar esta declaración migre cualquier dato automáticamente.

## 3. APIs declarativas

Los callbacks construyen planes inspeccionables. No ejecutan SQL ni permiten efectos arbitrarios. `input.title`, `todo.id` y demás son referencias simbólicas tipadas.

```ts
const TodoFilter = schema.enum(["all", "pending", "done"]);

const NewTodo = schema.object({
  title: schema.string().trim().minLength(1, "Escribe un título").maxLength(120),
  notes: schema.string().maxLength(2000),
});

const todos = defineApi({
  list: query({
    input: schema.object({ filter: TodoFilter }),

    select: ({ filter }) => db.match(filter, {
      all: () => db.todos.orderBy("createdAt", "desc").take(50),
      pending: () => db.todos
        .filterBy("done", "eq", false)
        .orderBy("createdAt", "desc")
        .take(50),
      done: () => db.todos
        .filterBy("done", "eq", true)
        .orderBy("createdAt", "desc")
        .take(50),
    }),
  }),

  byId: query({
    input: schema.object({ id: schema.id("todos") }),
    select: ({ id }) => db.todos.get(id), // Todo | null
  }),

  create: mutation({
    input: NewTodo,
    write: ({ title, notes }) => db.todos.insert({
      title,
      notes,
      done: false,
    }).returning("id"), // { id: Id<"todos"> }
  }),

  setDone: mutation({
    input: schema.object({
      id: schema.id("todos"),
      done: schema.boolean(),
    }),
    write: ({ id, done }) => db.todos.update(id, { done }),
    // update exige que exista el registro; si no, devuelve NotFound.
  }),

  remove: mutation({
    input: schema.object({ id: schema.id("todos") }),
    write: ({ id }) => db.todos.delete(id, { ifMissing: "ignore" }),
    // Borrado idempotente: eliminar una tarea ya eliminada es éxito.
  }),
});
```

`db.match` mantiene todas las ramas en el plan y exige cubrir cada valor de `TodoFilter`. `take(50)` limita deliberadamente la lista; no es paginación ni representa todas las tareas si hay más de 50 coincidencias.

Usamos `setDone(true/false)`, no un toggle calculado en el cliente: repetir la misma petición expresa el mismo estado deseado. Si dos clientes escriben valores opuestos, prevalece la última escritura confirmada. No hay control de versiones de negocio en este MVP.

Todas las entradas se validan en el servidor. Compartir `NewTodo` con el formulario mejora UX, pero no sustituye esa validación.

## 4. Referencias del cliente

```ts
import { api } from "./generated/api";
import { NewTodo, TodoFilter } from "./shared/contracts";
```

`api` contiene identificadores y contratos, no el código ni la conexión a SQLite. El generador conserva tipos de argumentos, resultados, clase de operación y dependencias de tablas para el runtime y el exportador.

## 5. App y cabecera común

Todos los componentes usan el doble nivel: setup declara dependencias; `c.render` devuelve una función de presentación y adjunta el contrato.

```ts
const App = component("App", (c) => {
  const home = c.transition(() => TodoList({ filter: "all" }));
  const create = c.transition(() => ui.modal(NewTodoDialog()));

  return c.render(
    { actions: { home, create } },
    ({ actions }) => ui.column([
      ui.header([
        ui.link("Mis tareas", actions.home),
        ui.slot("header.context"),
        ui.spacer(),
        ui.button("Nueva tarea", actions.create),
      ]),
      ui.connectionStatus(),
      ui.outlet({ initial: () => TodoList({ filter: "all" }) }),
      ui.overlays(),
    ]),
  );
});
```

La cabecera permanece durante las transiciones. Un modal conserva la página de fondo, pero vuelve inerte toda esa composición, incluida la cabecera.

## 6. Lista y filtro: acciones puramente de frontend

Cambiar de filtro sustituye los parámetros del contenido del outlet. Activa otra instancia de la query, pero no escribe en la base de datos.

```ts
const TodoList = component("TodoList", {
  props: { filter: TodoFilter },

  setup(c) {
    const items = c.query(api.todos.list, { filter: c.props.filter });
    const selectFilter = c.transition({
      input: schema.object({ filter: TodoFilter }),
      to: ({ filter }) => TodoList({ filter }),
    });
    const inspect = c.transition({
      input: schema.object({ id: schema.id("todos") }),
      to: ({ id }) => TodoDetail({ id, returnFilter: c.props.filter }),
    });
    const setDone = c.mutation(api.todos.setDone, {
      input: c.actionInput(api.todos.setDone),
      concurrency: "singlePerInputKey",
      key: "id",
      onError: "inline",
    });

    return c.render(
      {
        props: c.props,
        queries: { items },
        actions: { selectFilter, inspect, setDone },
      },
      ({ props, queries, actions }) => ui.fragment([
        ui.fill("header.context", ui.text("Lista")),
        ui.main([
          ui.h1("Tus tareas"),
          ui.tabs({
            value: props.filter,
            options: [
              { value: "all", label: "Todas",
                action: actions.selectFilter.bind({ filter: "all" }) },
              { value: "pending", label: "Pendientes",
                action: actions.selectFilter.bind({ filter: "pending" }) },
              { value: "done", label: "Hechas",
                action: actions.selectFilter.bind({ filter: "done" }) },
            ],
          }),
          ui.text("Se muestran hasta 50 tareas por selección."),
          ui.query(queries.items, {
            loading: () => ui.placeholder("Lista de tareas"),
            error: () => ui.column([
              ui.text("No se pudieron cargar las tareas"),
              ui.button("Reintentar", queries.items.retry),
            ]),
            success: (items) => ui.list(items, {
              empty: () => ui.text("No hay tareas en esta selección"),
              item: (todo) => TodoRow({
                todo,
                inspect: actions.inspect.bind({ id: todo.id }),
                complete: actions.setDone.bind({ id: todo.id, done: true }),
                reopen: actions.setDone.bind({ id: todo.id, done: false }),
              }),
            }),
          }),
        ]),
      ]),
    );
  },
});
```

Las acciones enlazadas de una fila comparten estado pendiente/error por `id`. No se bloquean todas las filas al completar una. El runtime mantiene el identificador de invocación para no confundir respuestas antiguas.

```ts
const TodoRow = component("TodoRow", {
  props: {
    todo: schema.itemOf(api.todos.list),
    inspect: schema.action(),
    complete: schema.action(),
    reopen: schema.action(),
  },

  setup(c) {
    return c.render({ props: c.props }, ({ props }) => ui.row([
      ui.link(props.todo.title, props.inspect),
      ui.when(props.todo.done, {
        true: () => ui.column([
          ui.badge("Hecha"),
          ui.button("Reabrir", props.reopen, { pendingLabel: "Guardando…" }),
          ui.actionError(props.reopen, { text: "No se pudo reabrir" }),
        ]),
        false: () => ui.column([
          ui.badge("Pendiente"),
          ui.button("Completar", props.complete, { pendingLabel: "Guardando…" }),
          ui.actionError(props.complete, { text: "No se pudo completar" }),
        ]),
      }),
    ]));
  },
});
```

No hay continuación de navegación al completar. Si estás en «Pendientes», la tarea desaparece cuando llega el nuevo resultado reactivo. En «Todas» cambia la etiqueta y aparece «Reabrir».

## 7. Crear: formulario local + escritura + transición

```ts
const NewTodoDialog = component("NewTodoDialog", (c) => {
  const draft = c.form({
    schema: NewTodo,
    initial: { title: "", notes: "" },
    validateOn: "submit",
  });
  const close = c.close();
  const clear = draft.reset(); // Efecto local declarativo, no mutación.
  const save = c.mutation(api.todos.create, {
    input: draft.values,
    validate: draft,
    concurrency: "single",
    onError: "inline",
    onSuccess: (created) => [
      close,
      c.transition(() => TodoDetail({ id: created.id, returnFilter: "all" })),
    ],
  });

  return c.render(
    { forms: { draft }, actions: { close, clear, save } },
    ({ forms, actions }) => ui.dialog({
      title: "Nueva tarea",
      close: actions.close,
      pending: actions.save.pending,
      dismissWhilePending: false,
      discardDraftOnClose: true,
      body: ui.form(forms.draft, {
        submit: actions.save,
        disableWhilePending: true,
        fields: [
          ui.input(forms.draft.fields.title, { label: "Título" }),
          ui.textarea(forms.draft.fields.notes, { label: "Notas" }),
        ],
        feedback: ui.actionError(actions.save, {
          text: "No se pudo crear. El borrador se conserva.",
        }),
        actions: [
          ui.button("Limpiar", actions.clear, { disabled: actions.save.pending }),
          ui.button("Cancelar", actions.close, { disabled: actions.save.pending }),
          ui.submit("Crear", { pendingLabel: "Creando…" }),
        ],
      }),
    }),
  );
});
```

`Limpiar` restaura campos y validación al estado inicial y limpia el error de envío asociado al formulario. No llama al servidor. No se permite limpiar ni cerrar durante el envío.

## 8. Detalle y confirmación de borrado

```ts
const TodoDetail = component("TodoDetail", {
  props: {
    id: schema.id("todos"),
    returnFilter: TodoFilter,
  },

  setup(c) {
    const todo = c.query(api.todos.byId, { id: c.props.id });
    const back = c.transition(() => TodoList({ filter: c.props.returnFilter }));
    const askDelete = c.transition(() => ui.modal(DeleteTodoDialog({
      id: c.props.id,
      returnFilter: c.props.returnFilter,
    })));

    return c.render(
      { queries: { todo }, actions: { back, askDelete } },
      ({ queries, actions }) => ui.fragment([
        ui.fill("header.context", ui.text("Detalle")),
        ui.main([
          ui.link("Volver a la lista", actions.back),
          ui.query(queries.todo, {
            loading: () => ui.placeholder("Detalle de tarea"),
            error: () => ui.column([
              ui.text("No se pudo cargar la tarea"),
              ui.button("Reintentar", queries.todo.retry),
            ]),
            success: (result) => ui.matchNullable(result, {
              null: () => ui.text("Esta tarea ya no existe"),
              value: (todo) => ui.column([
                ui.h1(todo.title),
                ui.text(todo.notes),
                ui.when(todo.done, {
                  true: () => ui.badge("Hecha"),
                  false: () => ui.badge("Pendiente"),
                }),
                ui.button("Eliminar tarea", actions.askDelete),
              ]),
            }),
          }),
        ]),
      ]),
    );
  },
});

const DeleteTodoDialog = component("DeleteTodoDialog", {
  props: {
    id: schema.id("todos"),
    returnFilter: TodoFilter,
  },

  setup(c) {
    const close = c.close();
    const remove = c.mutation(api.todos.remove, {
      input: { id: c.props.id },
      concurrency: "single",
      onError: "inline",
      onSuccess: () => [
        close,
        c.transition(() => TodoList({ filter: c.props.returnFilter })),
      ],
    });

    return c.render(
      { actions: { close, remove } },
      ({ actions }) => ui.dialog({
        title: "Eliminar tarea",
        close: actions.close,
        pending: actions.remove.pending,
        dismissWhilePending: false,
        body: ui.column([
          ui.text("Esta acción no se puede deshacer."),
          ui.actionError(actions.remove, { text: "No se pudo eliminar. Reintenta." }),
          ui.button("Cancelar", actions.close, { disabled: actions.remove.pending }),
          ui.button("Eliminar definitivamente", actions.remove, {
            pendingLabel: "Eliminando…",
            intent: "danger",
          }),
        ]),
      }),
    );
  },
});
```

## 9. Persistencia y reactividad: recorrido de una acción

Ejemplo: completar una tarea mientras dos clientes muestran pendientes.

```text
Cliente A                         Servidor / SQLite                Cliente B
   │                                      │                            │
   ├── todos.setDone(id, true) ───────────►│                            │
   │                                      ├── BEGIN                    │
   │                                      ├── UPDATE todos             │
   │                                      ├── incrementar versión      │
   │                                      ├── registrar evento outbox  │
   │                                      └── COMMIT                   │
   │◄── éxito + versión confirmada ────────┤                            │
   │◄── SSE: todos versión 12 ─────────────┼───────────────────────────►│
   │                                      │                            │
   ├── list(pending) ─────────────────────►│◄────── list(pending) ──────┤
   │◄── resultado + versión 12 ────────────┼────── resultado v12 ──────►│
   │                                      │                            │
   └── quitar tarea de la lista            │          quitar tarea ─────┘
```

El orden relativo entre respuesta de mutación y evento SSE puede variar; no se depende del orden dibujado. La respuesta también comunica la versión confirmada para invalidar en el cliente iniciador sin esperar al stream.

Dependencias inferidas de los planes:

```text
todos.list(all | pending | done) ── lee ─────► tabla todos
todos.byId(id) ─────────────────── lee ─────► tabla todos

todos.create   ─────────────────── inserta ─► tabla todos
todos.setDone  ─────────────────── actualiza► tabla todos
todos.remove   ─────────────────── borra ──► tabla todos

Commit sobre todos
  → invalidar todas las queries ACTIVAS que lean todos
  → SSE transporta invalidaciones, no filas
  → cliente vuelve a consultar y deduplica por operación + argumentos
```

Protocolo mínimo para que no se pierdan cambios:

- Una versión monótona por tabla. Datos y versiones de una respuesta se leen en el mismo snapshot transaccional.
- Incremento de versión y evento persistido en la misma transacción que la escritura. Un publicador lee el outbox y envía los eventos confirmados.
- Al conectar el stream se entrega la versión actual. El cliente compara ese watermark y las invalidaciones recibidas con cada respuesta de query. Si una respuesta es anterior, vuelve a consultar.
- Al reconectar se recuperan eventos por cursor si siguen disponibles; si no, se invalidan todas las queries activas y se obtiene un watermark nuevo.
- Un evento recibido durante un refetch no se descarta: si ese refetch no alcanza su versión, se consulta otra vez.
- Se descartan respuestas de peticiones obsoletas y de argumentos que ya no están activos.
- SSE puede entregar duplicados. Las versiones permiten ignorarlos. El outbox requiere retención/limpieza.
- No se reintentan automáticamente mutaciones no idempotentes como `create` tras una respuesta perdida. En ese caso el resultado puede ser incierto; una futura clave de idempotencia permitiría reintentar sin duplicar tareas.

La reactividad se calcula por tabla en este MVP: puede hacer consultas de más, pero incluye correctamente tareas que entran o salen de un filtro. No se promete un cambio atómico de varias queries en el navegador.

## 10. Wireframe exportado: pantallas conectadas

Representación escrita manualmente del resultado esperado; no se ha generado con herramientas.

```text
┌─ LISTA · App / Header / TodoList(filter) ───────────────────┐
│ [Mis tareas]       Lista                      [Nueva tarea] ───────┐
│ Tus tareas                                                │      │ abre modal
│ [Todas] [Pendientes] [Hechas]                               │      ▼
│   └── transición al mismo outlet con otro filter           │  ┌─ NUEVA TAREA ──────────────┐
│                                                           │  │ Título [________________] │
│ Comprar pan                  Pendiente [Completar] ───┐    │  │ Notas  [________________] │
│     │ enlace                                         │    │  │ [Limpiar] → reset local   │
│     │                                                │    │  │ [Cancelar] → cerrar       │
└─────┼────────────────────────────────────────────────┼────┘  │ [Crear] ───────────────┐  │
      │ id                                             │       └────────────────────────┼──┘
      │                                                │                                │
      │                                                ▼                                ▼
      │                                      todos.setDone(id, true)          todos.create(form)
      │                                        ├── fallo: error en fila        ├── inválido: no enviar
      │                                        └── éxito: permanecer           ├── fallo: conservar campos
      │                                            SSE → refetch               └── éxito: cerrar
      │                                                                          │ result.id
      ▼                                                                          ▼
┌─ DETALLE · App / Header / TodoDetail(id, returnFilter) ──────────────────────────────┐
│ [Mis tareas]             Detalle                                    [Nueva tarea] │
│ [Volver a la lista] → LISTA(returnFilter)                                          │
│ Comprar pan                                                                      │
│ Notas de la tarea                                                                │
│ Pendiente                                                                        │
│ [Eliminar tarea] ───────────────────────────┐                                     │
└────────────────────────────────────────────┼─────────────────────────────────────┘
                                             │ abre modal, conserva detalle debajo
                                             ▼
                                 ┌─ CONFIRMAR BORRADO ─────────────────────┐
                                 │ Esta acción no se puede deshacer.       │
                                 │ [Cancelar] → cerrar, conservar detalle  │
                                 │ [Eliminar definitivamente]             │
                                 └───────────┬────────────────────────────┘
                                             ▼
                                      todos.remove(id)
                                        ├── fallo: permanecer + error
                                        └── éxito: cerrar → LISTA(returnFilter)
```

La cabecera permite abrir «Nueva tarea» también desde el detalle. Cancelar conserva el detalle; crear con éxito abre el detalle de la nueva tarea. El modal no es un componente registrado como vista: el exportador lo identifica por su uso en `ui.modal`.

### Variantes que también exporta

| Región | Variantes |
|---|---|
| Lista | Carga / error + reintento / vacía / con tareas |
| Cada tarea | Pendiente + completar / hecha + reabrir |
| Acción de fila | Idle / guardando y bloqueada / error y reintento |
| Detalle | Carga / error + reintento / ausente / datos |
| Formulario nuevo | Edición / errores de campo / enviando / fallo de servidor |
| Confirmación de borrado | Confirmación / eliminando / fallo de servidor |
| Conexión | Conectado / reconectando con resultados anteriores |

Las variantes se muestran por región, no mediante el producto cartesiano de todos los estados. Los destinos con ids se representan como plantillas; los ciclos de navegación se enlazan, no se expanden infinitamente.

## 11. Qué se podría probar

Ejemplos de casos, no tests ejecutados:

1. Insertar una tarea, reiniciar el servidor y comprobar que sigue en SQLite.
2. Crear sin título: error local y cero peticiones de mutación; una petición directa inválida también falla en el servidor.
3. Limpiar/cancelar un borrador: cero escrituras en DB.
4. Completar desde «Pendientes»: desaparece tras refetch; desde «Todas»: cambia a «Hecha».
5. Dos clientes: una escritura en A actualiza las queries activas de B por SSE.
6. Perder conexión, escribir desde otro cliente y reconectar: recuperar el estado vigente.
7. Borrar desde el detalle: cerrar confirmación y volver al filtro de origen.
8. Borrado remoto mientras el detalle está abierto: mostrar «Esta tarea ya no existe».
9. Respuesta antigua después de una invalidación nueva: no dejar el cliente con datos obsoletos.
10. Exportar y comprobar que cada botón tiene un efecto o destino trazable, incluidos limpiar, reintentar y las continuaciones de mutaciones.
