# Mini app: proyectos

> Ejemplo histórico. La API vigente se describe en [DSL cerrado](../docs/declarative-dsl.md) y [rutas = vistas](../docs/routing-and-wireframes.md). Este boceto conserva los casos funcionales, no la sintaxis actual.

Ejemplo de diseño de API. No es código ejecutable: los helpers y su implementación todavía no existen.

El objetivo es escribir una sola definición que permita renderizar la app y exportar todas sus vistas, variantes y transiciones.

## Qué hace

- Cabecera común con usuario, navegación y una zona contextual por vista.
- Lista de proyectos con filtro «Activos / Todos».
- Detalle de un proyecto y acción para archivarlo.
- Modal de creación con formulario, validación y envío.
- Queries reactivas: crear o archivar actualiza las vistas sin invalidaciones manuales.

## 1. Contrato del servidor

Estos son los contratos que consume el ejemplo, no su implementación. Los nombres y tipos se importarían del backend.

```ts
type Project = {
  id: ProjectId;
  name: string;
  description: string;
  archived: boolean;
};

// Queries reactivas
api.session.me(): { name: string };
api.projects.list({ scope: "active" | "all" }): Project[];
api.projects.byId({ id: ProjectId }): Project | null;

// Mutaciones
api.projects.create({ name: string; description: string }): { id: ProjectId };
api.projects.archive({ id: ProjectId }): void;
```

El servidor valida entradas y permisos independientemente de la UI.

## 2. Convenciones mínimas de esta API

- `view` y `layout` construyen definiciones, no componentes con efectos arbitrarios.
- `ui.*` construye un árbol de interfaz inspeccionable.
- `ui.query`, `ui.when` y `ui.list` conservan sus variantes para exportarlas.
- Los argumentos de sus callbacks son referencias tipadas: `project.name` representa un campo, no un string disponible durante la definición.
- `ui.text("Proyecto: ", project.name)` compone texto sin perder esa referencia.
- `v.transition` describe una transición; no la ejecuta mientras se define la vista.
- Las referencias a vistas usan `() => View` para permitir referencias circulares.
- `v.mutation` describe una operación y sus continuaciones. El runtime gestiona pendiente y error.
- Los formularios son borradores locales gestionados, no una copia editable de la base de datos.
- Las funciones de construcción deben ser puras. Condiciones de UI se expresan con `ui.when`, no con `if` sobre referencias simbólicas.

## 3. App y cabecera compartida

La cabecera tiene una parte estable y dos huecos que completa la página activa: contexto y acciones. Un modal no sustituye esa página ni su cabecera.

```ts
const Shell = layout("shell", (l) => {
  const me = l.query(api.session.me, {});

  return ui.column([
    ui.header([
      ui.link("Mini Projects", l.transition(() => Projects)),
      ui.slot("context"),
      ui.spacer(),
      ui.slot("actions"),

      ui.query(me, {
        loading: () => ui.text("Cargando usuario…"),
        error: () => ui.button("Reintentar usuario", me.retry),
        success: (user) => ui.text(user.name),
      }),
    ]),

    ui.main(l.outlet()),
    l.overlays(),
  ]);
});

const app = defineApp({
  id: "mini-projects",
  layout: Shell,
  initial: () => Projects,
  views: [Projects, ProjectDetail, CreateProject],
});
```

El registro `views` permite enumerar la app completa, también vistas sin enlaces de entrada. Los slots pueden tiparse desde `Shell`.

## 4. Lista de proyectos

El filtro es un parámetro de vista. Cambiarlo es una transición a la misma vista con otra entrada, no un estado de dominio local.

```ts
const Projects = view("projects", {
  presentation: "page",
  layout: Shell,

  params: schema.object({
    scope: schema.enum(["active", "all"]).default("active"),
  }),

  setup(v) {
    const projects = v.query(api.projects.list, {
      scope: v.params.scope,
    });

    const create = v.transition(() => CreateProject);

    return ui.page({
      slots: {
        context: ui.text("Proyectos"),
        actions: ui.button("Crear proyecto", create),
      },

      body: ui.column([
        ui.h1("Tus proyectos"),

        ui.tabs({
          value: v.params.scope,
          options: [
            {
              value: "active",
              label: "Activos",
              action: v.transition(() => Projects, { scope: "active" }),
            },
            {
              value: "all",
              label: "Todos",
              action: v.transition(() => Projects, { scope: "all" }),
            },
          ],
        }),

        ui.query(projects, {
          loading: () => ui.placeholder("Lista de proyectos"),

          error: () => ui.column([
            ui.text("No se pudieron cargar los proyectos."),
            ui.button("Reintentar", projects.retry),
          ]),

          success: (items) => ui.list(items, {
            empty: () => ui.column([
              ui.text("No hay proyectos en esta selección."),
              ui.button("Crear proyecto", create),
            ]),

            item: (project) => ui.card([
              ui.h2(project.name),
              ui.text(project.description),
              ui.when(project.archived, {
                true: () => ui.badge("Archivado"),
                false: () => ui.badge("Activo"),
              }),
              ui.link("Ver proyecto", v.transition(() => ProjectDetail, {
                id: project.id,
                returnScope: v.params.scope,
              })),
            ]),
          }),
        }),
      ]),
    });
  },
});
```

## 5. Detalle: misma cabecera, contenido contextual distinto

El nombre aparece en la cabecera cuando la query está disponible. La cabecera y el cuerpo observan el mismo recurso: no se crean dos suscripciones independientes.

Archivar no navega. La query reactiva actualiza la etiqueta y elimina la acción de archivar cuando el servidor publica el nuevo resultado.

```ts
const ProjectDetail = view("project.detail", {
  presentation: "page",
  layout: Shell,

  params: schema.object({
    id: schema.projectId(),
    returnScope: schema.enum(["active", "all"]).default("active"),
  }),

  setup(v) {
    const project = v.query(api.projects.byId, { id: v.params.id });

    const back = v.transition(() => Projects, {
      scope: v.params.returnScope,
    });

    const archive = v.mutation(api.projects.archive, {
      input: { id: v.params.id },
      concurrency: "single",
      onSuccess: [], // Permanecer; la información cambia por reactividad.
      onError: "inline",
    });

    return ui.page({
      slots: {
        context: ui.query(project, {
          loading: () => ui.text("Proyectos / Cargando…"),
          error: () => ui.text("Proyectos / Error"),
          success: (result) => ui.matchNullable(result, {
            null: () => ui.text("Proyectos / No encontrado"),
            value: (p) => ui.text("Proyectos / ", p.name),
          }),
        }),
        actions: ui.link("Volver a proyectos", back),
      },

      body: ui.query(project, {
        loading: () => ui.placeholder("Detalle del proyecto"),

        error: () => ui.column([
          ui.text("No se pudo cargar el proyecto."),
          ui.button("Reintentar", project.retry),
        ]),

        success: (result) => ui.matchNullable(result, {
          null: () => ui.column([
            ui.h1("Proyecto no encontrado"),
            ui.link("Volver a proyectos", back),
          ]),

          value: (p) => ui.column([
            ui.h1(p.name),
            ui.text(p.description),

            ui.when(p.archived, {
              true: () => ui.badge("Archivado"),
              false: () => ui.column([
                ui.badge("Activo"),
                ui.button("Archivar proyecto", archive, {
                  pendingLabel: "Archivando…",
                }),
                ui.actionError(archive, {
                  text: "No se pudo archivar. Puedes intentarlo de nuevo.",
                }),
              ]),
            }),
          ]),
        }),
      }),
    });
  },
});
```

## 6. Modal de creación

Los campos viven en un formulario gestionado. Cancelar descarta el borrador. Un fallo conserva sus valores.

```ts
const CreateProject = view("project.create", {
  presentation: "modal",

  setup(v) {
    const form = v.form({
      schema: schema.object({
        name: schema.string().trim().minLength(1, "Escribe un nombre"),
        description: schema.string(),
      }),
      initial: { name: "", description: "" },
      validateOn: "submit",
    });

    const save = v.mutation(api.projects.create, {
      input: form.values,
      validate: form,
      concurrency: "single",

      onSuccess: (created) => [
        v.close(),
        v.transition(() => ProjectDetail, { id: created.id }),
      ],

      onError: "inline",
    });

    return ui.modal({
      title: "Crear proyecto",
      close: v.close(),
      dismissWhilePending: false,
      pending: save.pending,
      discardDraftOnClose: true,

      body: ui.form(form, {
        submit: save,
        fields: [
          ui.input(form.fields.name, { label: "Nombre" }),
          ui.textarea(form.fields.description, { label: "Descripción" }),
        ],

        feedback: ui.actionError(save, {
          text: "No se pudo crear el proyecto. Tus cambios se conservan.",
        }),

        actions: [
          ui.button("Cancelar", v.close(), { disabled: save.pending }),
          ui.submit("Crear proyecto", { pendingLabel: "Creando…" }),
        ],
      }),
    });
  },
});
```

Las continuaciones describen el flujo; no son callbacks opacos que ejecutan navegación. `created.id` es una referencia al resultado futuro de la mutación.

## 7. Políticas del runtime que aparecen en la exportación

Pueden ser valores por defecto del framework, pero el revisor debe ver su comportamiento efectivo:

- Una transición a página sustituye la página activa; una transición a modal la conserva debajo.
- El modal bloquea la interacción con el fondo, captura el foco y lo devuelve al disparador al cancelar.
- Escape, cierre y cancelar descartan el formulario, salvo mientras se está enviando, cuando están bloqueados.
- Submit valida primero. Si hay errores, no llama al servidor y muestra errores junto a los campos.
- Mientras una mutación está pendiente no admite otro envío. El formulario de creación bloquea también sus campos.
- Un fallo de envío conserva los campos y permite reintentar mediante el mismo botón.
- Un cambio reactivo de datos no vuelve a mostrar carga inicial. Ante una pérdida de conexión con datos previos, se conservan y se muestra el aviso compartido «Reconectando…».
- Si cambia la entrada de una query, se muestra carga para esa nueva entrada salvo que el runtime ya tenga un resultado válido para ella.
- Mutación confirmada y resultado reactivo actualizado son eventos distintos. Este MVP no aplica actualizaciones optimistas: puede verse brevemente el dato anterior hasta recibir el nuevo resultado.
- El estado del usuario es independiente del estado de cada página: el fallo de esa query no elimina su contenido. La autorización real sigue siendo del servidor.

## 8. Wireframe exportado

El siguiente documento se generaría a partir del árbol anterior. Los textos «Web pública» y «Ana» son fixtures ilustrativos; no forman parte del contrato funcional. Sin fixtures, se mostrarían etiquetas como `[project.name]`.

### 8.1 Mapa de transiciones

```text
SHELL: cabecera común + página activa + overlays
│
├── PROYECTOS(scope: active | all)
│   ├── [Activos] ───────────────► PROYECTOS(active)
│   ├── [Todos] ────────────────► PROYECTOS(all)
│   ├── [Crear proyecto] ───────► CREAR PROYECTO [modal]
│   └── [Ver proyecto(id)] ─────► DETALLE(id, returnScope)
│
├── DETALLE(id, returnScope)
│   ├── [Volver] ───────────────► PROYECTOS(returnScope)
│   └── [Archivar] ─────────────► projects.archive(id)
│       ├── pendiente: botón bloqueado
│       ├── error: mensaje + reintento; permanecer
│       └── éxito: permanecer; query actualiza el contenido
│
└── CREAR PROYECTO [sobre la página de origen]
    ├── [Cancelar / Escape / ×] ► cerrar; descartar borrador
    └── [Crear proyecto]
        ├── formulario inválido ► errores de campos; no enviar
        └── válido ────────────► projects.create(form)
            ├── pendiente: bloquear formulario y cierre
            ├── error: conservar valores; permitir reintento
            └── éxito ─────────► cerrar modal → DETALLE(result.id)

GLOBAL: [Mini Projects] → PROYECTOS(active)
        [Reintentar usuario] → reintentar session.me

REINTENTOS DE DATOS: error de lista/detalle → reintentar su query
```

### 8.2 Cabecera compartida

```text
Lista:
┌──────────────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos                [Crear proyecto]  Ana      │
└──────────────────────────────────────────────────────────────────────┘

Detalle:
┌──────────────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos / Web pública  [Volver a proyectos]  Ana  │
└──────────────────────────────────────────────────────────────────────┘

Variantes de usuario (independientes de la página):
  Cargando → «Cargando usuario…»
  Error    → [Reintentar usuario]
  Datos    → [user.name]

Variantes del contexto del detalle:
  Cargando → «Proyectos / Cargando…»
  Error    → «Proyectos / Error»
  Ausente  → «Proyectos / No encontrado»
  Datos    → «Proyectos / [project.name]»

Con modal abierto: conservar cabecera de la página de fondo, inerte.
Con conexión interrumpida y datos previos: aviso común «Reconectando…».
```

### 8.3 Proyectos: contenido disponible

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos                [Crear proyecto]  Ana      │
├──────────────────────────────────────────────────────────────────────┤
│ Tus proyectos                                                        │
│                                                                      │
│ [Activos ●] [Todos ○]                                                 │
│                                                                      │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ Web pública                                              Activo │ │
│ │ Nueva web para el estudio                                       │ │
│ │ [Ver proyecto →]                                                │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ Repetir tarjeta por cada projects.list(scope)                         │
│ Campos: name, description, archived                                  │
└──────────────────────────────────────────────────────────────────────┘
```

En «Todos» pueden aparecer tarjetas con etiqueta «Archivado». La disposición no cambia.

### 8.4 Proyectos: otras variantes

La cabecera y las pestañas permanecen visibles en las tres variantes.

```text
CARGANDO                  ERROR                       VACÍO
┌──────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    │  │ No se pudieron cargar  │  │ No hay proyectos en    │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒    │  │ los proyectos.         │  │ esta selección.        │
│ Lista de proyectos   │  │ [Reintentar]           │  │ [Crear proyecto]       │
└──────────────────────┘  └────────────────────────┘  └────────────────────────┘
```

### 8.5 Detalle

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos / Web pública  [Volver a proyectos]  Ana  │
├──────────────────────────────────────────────────────────────────────┤
│ Web pública                                                          │
│ Nueva web para el estudio                                            │
│                                                                      │
│ Activo                                                               │
│ [Archivar proyecto]                                                  │
└──────────────────────────────────────────────────────────────────────┘

VARIANTES DEL CUERPO
├── Cargando: placeholder «Detalle del proyecto»
├── Error: «No se pudo cargar el proyecto» + [Reintentar]
├── Ausente: «Proyecto no encontrado» + [Volver a proyectos]
└── Disponible
    ├── Activo: etiqueta + [Archivar proyecto]
    │   ├── Pendiente: [Archivando… deshabilitado]
    │   └── Error: mensaje bajo el botón; permite reintentar
    └── Archivado: etiqueta «Archivado», sin acción de archivar
```

### 8.6 Crear proyecto: modal y contexto

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos                [Crear proyecto]  Ana      │
├──────────────────────────────────────────────────────────────────────┤
│ Tus proyectos                 FONDO INERTE                           │
│ [Activos ●] [Todos ○]                                                 │
│                                                                      │
│       ┌──────────────────────────────────────────────────────┐       │
│       │ Crear proyecto                                  [×]  │       │
│       │                                                      │       │
│       │ Nombre *                                             │       │
│       │ [_______________________________________________]    │       │
│       │                                                      │       │
│       │ Descripción                                          │       │
│       │ [_______________________________________________]    │       │
│       │ [_______________________________________________]    │       │
│       │                                                      │       │
│       │                    [Cancelar] [Crear proyecto]       │       │
│       └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.7 Modal: variantes

```text
EDICIÓN
  Campos editables. Cancelar / Escape / × descartan el borrador.

VALIDACIÓN FALLIDA
  Nombre: [________________]
          Escribe un nombre
  No se ha llamado al servidor.

ENVIANDO
  Campos deshabilitados, valores visibles.
  [Cancelar deshabilitado] [Creando… deshabilitado]
  Escape y × bloqueados.

ERROR DE SERVIDOR
  Campos editables, valores conservados.
  «No se pudo crear el proyecto. Tus cambios se conservan.»
  [Cancelar] [Crear proyecto]

ÉXITO
  No hay una pantalla de éxito independiente.
  Cerrar modal → Detalle del proyecto creado.
  El detalle puede mostrar su carga inicial hasta recibir su query.
```

## 9. Qué garantiza esta exportación y qué no

La exportación enumera la estructura declarada: contenido, dependencias, variantes, condiciones y transiciones. No necesita enumerar todos los valores posibles de una query ni todas las combinaciones de regiones independientes.

No verifica que el servidor implemente correctamente permisos, filtros o mutaciones. Tampoco prueba por sí sola accesibilidad o fidelidad del renderizador: eso requiere tests y comprobación de la app real.

La restricción necesaria es que el comportamiento funcional no se esconda en callbacks de DOM arbitrarios. Los helpers de interfaz, recursos, formularios y acciones deben producir nodos inspeccionables. El renderer y el exportador consumen esos mismos nodos.
