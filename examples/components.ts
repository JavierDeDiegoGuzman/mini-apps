/*
 * PROPUESTA DE API — NO EJECUTABLE.
 * Los imports @mini/framework y ./server-contract son hipotéticos.
 *
 * Doble nivel:
 *   component(setup) → render(dependencias, presentación) → función de presentación.
 *
 * setup registra recursos y efectos, sin ejecutarlos.
 * c.render devuelve una función y adjunta el contrato inspeccionable.
 * Los argumentos de presentación son referencias tipadas, no valores JS libres.
 * ui.query/list conservan ramas y plantillas para el exportador.
 *
 * Este ejemplo sustituye conceptualmente view/layout del boceto projects.md.
 */
import { component, ui, schema } from "@mini/framework";
import { api } from "./server-contract";

// Contrato esperado del backend:
// session.me() → { name: string }
// projects.list() → Array<{ id: ProjectId; name: string; description: string }>
// projects.byId({ id }) → Project | null
// projects.create({ name, description }) → { id: ProjectId }
// Todas las queries son suscripciones reactivas.

export const App = component("App", (c) => {
  const user = c.query(api.session.me, {});
  const home = c.transition(() => Projects());

  return c.render(
    { queries: { user }, actions: { home } },
    ({ queries, actions }) =>
      ui.column([
        Header({ user: queries.user, home: actions.home }),
        ui.outlet({ initial: () => Projects() }),
        ui.overlays(),
      ]),
  );
});

// Props tipadas por un schema/contrato de puertos.
// Pasar un recurso a un hijo no crea otra suscripción.
const Header = component("Header", {
  props: {
    user: schema.queryOf(api.session.me),
    home: schema.action(),
  },
  setup(c) {
    return c.render(
      { props: c.props },
      ({ props }) =>
        ui.header([
          ui.link("Mini Projects", props.home),
          ui.slot("header.context"),
          ui.spacer(),
          ui.slot("header.actions"),
          ui.query(props.user, {
            loading: () => ui.text("Cargando usuario…"),
            error: () => ui.text("Usuario no disponible"),
            success: (user) => ui.text(user.name),
          }),
        ]),
    );
  },
});

export const Projects = component("Projects", (c) => {
  const projects = c.query(api.projects.list, {});
  const create = c.transition(() => ui.modal(CreateProject()));
  // Acción parametrizada: la tarjeta proporciona el id al enlazarla.
  const inspect = c.transition({
    input: schema.object({ id: schema.projectId() }),
    to: (input) => ProjectDetail({ id: input.id }),
  });

  return c.render(
    { queries: { projects }, actions: { create, inspect } },
    ({ queries, actions }) =>
      ui.fragment([
        ui.fill("header.context", ui.text("Proyectos")),
        ui.fill("header.actions", ui.button("Crear proyecto", actions.create)),
        ui.main([
          ui.h1("Tus proyectos"),
          ui.query(queries.projects, {
            loading: () => ui.placeholder("Lista de proyectos"),
            error: () => ui.column([
              ui.text("No se pudieron cargar los proyectos"),
              ui.button("Reintentar", queries.projects.retry),
            ]),
            success: (items) => ui.list(items, {
              empty: () => ui.column([
                ui.text("Todavía no tienes proyectos"),
                ui.button("Crear el primero", actions.create),
              ]),
              item: (project) => ProjectCard({
                project,
                open: actions.inspect.bind({ id: project.id }),
              }),
            }),
          }),
        ]),
      ]),
  );
});

// Componente de presentación reutilizable: no conoce queries ni destinos.
const ProjectCard = component("ProjectCard", {
  props: {
    project: schema.itemOf(api.projects.list),
    open: schema.action(),
  },
  setup(c) {
    return c.render(
      { props: c.props },
      ({ props }) => ui.card([
        ui.h2(props.project.name),
        ui.text(props.project.description),
        ui.link("Ver proyecto", props.open),
      ]),
    );
  },
});

export const ProjectDetail = component("ProjectDetail", {
  props: { id: schema.projectId() },
  setup(c) {
    const project = c.query(api.projects.byId, { id: c.props.id });
    const back = c.transition(() => Projects());

    return c.render(
      { queries: { project }, actions: { back } },
      ({ queries, actions }) => ui.fragment([
        ui.fill("header.context", ui.text("Detalle del proyecto")),
        ui.fill("header.actions", ui.link("Volver", actions.back)),
        ui.main([
          ui.query(queries.project, {
            loading: () => ui.placeholder("Detalle"),
            error: () => ui.column([
              ui.text("No se pudo cargar el proyecto"),
              ui.button("Reintentar", queries.project.retry),
            ]),
            success: (result) => ui.matchNullable(result, {
              null: () => ui.text("Proyecto no encontrado"),
              value: (project) => ui.column([
                ui.h1(project.name),
                ui.text(project.description),
              ]),
            }),
          }),
        ]),
      ]),
    );
  },
});

export const CreateProject = component("CreateProject", (c) => {
  const form = c.form({
    schema: schema.object({
      name: schema.string().trim().minLength(1, "Escribe un nombre"),
      description: schema.string(),
    }),
    initial: { name: "", description: "" },
    validateOn: "submit",
  });

  const close = c.close();
  const save = c.mutation(api.projects.create, {
    input: form.values,
    validate: form,
    concurrency: "single",
    onSuccess: (result) => [
      close,
      c.transition(() => ProjectDetail({ id: result.id })),
    ],
    onError: "inline",
  });

  return c.render(
    { forms: { project: form }, actions: { close, save } },
    ({ forms, actions }) => ui.dialog({
      title: "Crear proyecto",
      close: actions.close,
      dismissWhilePending: false,
      pending: actions.save.pending,
      discardDraftOnClose: true,
      body: ui.form(forms.project, {
        submit: actions.save,
        disableWhilePending: true,
        fields: [
          ui.input(forms.project.fields.name, { label: "Nombre" }),
          ui.textarea(forms.project.fields.description, { label: "Descripción" }),
        ],
        feedback: ui.actionError(actions.save, {
          text: "No se pudo crear. Tus cambios se conservan.",
        }),
        actions: [
          ui.button("Cancelar", actions.close, {
            disabled: actions.save.pending,
          }),
          ui.submit("Crear proyecto", { pendingLabel: "Creando…" }),
        ],
      }),
    }),
  );
});
