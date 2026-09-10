# Rutas = vistas: estructura, navegación y wireframe

Estado: decisión de diseño vigente; sintaxis ilustrativa, no implementación.

## 1. Vocabulario

**Vista y ruta son el mismo concepto en este framework:** un lugar al que el usuario puede llegar mediante una transición. No hay registro adicional de vistas ni un mapa independiente que tenga que mantenerse sincronizado.

Un componente es una pieza de composición. Una tarjeta, cabecera o formulario no son rutas por sí mismos. Una composición se convierte en ruta al registrarla como destino en el árbol de navegación.

La categoría de ruta no se infiere inspeccionando si el componente devuelve `ui.page` o `ui.modal`. La intención de navegación es explícita en el árbol. Esto sustituye la propuesta anterior de inferir presentación desde la raíz del componente.

## 2. Inspiración: Shape Up y Expo Router

En *Shape Up*, capítulo «Find the Elements», breadboarding distingue lugares, elementos de interacción y conexiones. Los lugares incluyen pantallas, diálogos y menús emergentes. Para estudiar conexiones, un destino puede ser página o modal sin cambiar su identidad funcional. Esta referencia concreta es Shape Up, no una definición que atribuyamos a Rework.

Expo Router hace que ciertos componentes sean rutas por su posición en `src/app`; los componentes reutilizables viven fuera. Los layouts definen contexto compartido y navegadores, y una ruta del stack puede tener presentación modal. No deduce qué es una ruta analizando su JSX.

Tomamos esa frontera explícita, pero representada en un objeto dentro del single export, no obligatoriamente mediante archivos. Expo permite también modales locales no navegables; nuestro modelo prioriza registrar como rutas los diálogos que queremos revisar como lugares del flujo.

## 3. Árbol explícito

```ts
const routes = router({
  layout: AppShell,

  children: {
    projects: route({
      path: "/projects",
      component: ProjectList,

      children: {
        create: route({
          path: "new",
          component: CreateProject,
          presentation: "modal",
        }),

        detail: route({
          path: ":id",
          params: { id: projects.idSchema },
          component: ProjectDetail,

          children: {
            edit: route({
              path: "edit",
              component: EditProject,
              presentation: "modal",
            }),
          },
        }),
      },
    }),
  },
});
```

```text
AppShell
└── Proyectos             /projects
    ├── Crear [modal]     /projects/new
    └── Detalle(id)       /projects/:id
        └── Editar        /projects/:id/edit [modal]
```

Página es la presentación por defecto. La definición de ruta es la única autoridad sobre presentación. `ui.dialog` puede aportar estructura accesible al contenido, pero no registra un destino ni decide historial/stack.

La construcción puede usar handles y callbacks puros con ctx tipado para enlazar rutas/componentes. Ninguna función diferida queda en el manifiesto. Los proveedores y montajes deben ser descubribles para calcular el contexto común de componentes reutilizados; véase [contexto e inferencia](./context-and-inference.md).

## 4. Navegar siempre es apuntar al destino

```ts
transition.to(routes.projects.create)
transition.to(routes.projects.detail).with({ id: project.id })
transition.to(routes.projects.detail.edit).with({ id: project.id })
```

No hay `.asModal()` en el enlace. Abrir Editar siempre usa la presentación definida por esa ruta, desde cualquier origen.

Los destinos tipados permiten verificar props, parámetros obligatorios y tipo de id. Los parámetros dinámicos se heredan por los hijos: Editar recibe el id de Detalle. Cada parámetro direccionable tiene codec de URL; una URL no se acepta por ser simplemente un string.

Para rutas del MVP, los parámetros de identidad obligatorios deben poder construirse a partir de URL/herencia y defaults declarados. Los componentes también pueden consumir recursos/formularios mediante `ctx.ctx` proporcionados por sus ancestros, sin bindings por cada nivel. Esos proveedores deben poder reconstruirse entrando directamente por URL. No pasar objetos de base de datos completos como estado oculto indispensable: pasar ids, consultar y compartir el handle del recurso.

## 5. Qué significa anidar

No confundir jerarquía de rutas con anidamiento visual de todas sus páginas:

- Un hijo página sustituye el contenido de página; no mantiene automáticamente el cuerpo de su padre visible.
- Un hijo modal se superpone al contexto visual de su padre.
- Los layouts de ancestros se componen y permanecen visibles mientras la ruta siga bajo ellos.
- Un layout usa un outlet para insertar el contenido de sus descendientes.

Así, Detalle conserva AppShell, pero no el cuerpo de la lista. Editar conserva AppShell y el detalle detrás. **Contenido visible y ámbito activo no son lo mismo:** los proveedores de ruta/layout de un ancestro permanecen activos mientras se navega entre sus hijos con la misma identidad, aunque su cuerpo sea sustituido. Un proveedor dentro de un fragmento de UI desmontado no obtiene esa retención automáticamente.

Una cabecera común puede tener slots de contexto y acciones completados por la página activa. Por defecto un modal no sustituye esos fills; sí vuelve inerte el fondo. Las claves de slots se validan contra el layout.

## 6. URLs de modales y contexto canónico

Todas las rutas tienen dirección, también los modales. Abrir directamente:

```text
/projects/123/edit
```

construye:

```text
AppShell
├── página ProjectDetail(id: 123)
└── modal EditProject(id: 123)
```

El padre del modal determina su fondo canónico. Al abrir ese modal desde otro sitio se construye ese mismo contexto, no se conserva un fondo arbitrario según el origen. Es una restricción deliberada para que URL, navegación y wireframe tengan una interpretación estable.

Un hijo modal de otro modal puede formar una pila, si lo soporta el runtime; no es necesario implementarlo en la primera vertical. No habrá paneles navegables independientes ni varios outlets de navegación concurrentes en el MVP.

Si falta la entidad del padre o del propio modal, cada recurso representa su error tipado; no asumir que construir una ruta garantiza que existan sus datos. Padre e hijo pueden consumir el mismo recurso de contexto sin crear otra instancia de estado. Una frontera de carga/error en el ancestro puede cubrir al subárbol si está declarada explícitamente.

Los modales heredan proveedores del padre canónico incluso mediante portales. Sus componentes reutilizados solo pueden consumir la parte compatible común a todos sus montajes. Las conexiones de navegación desde otros orígenes no añaden contexto. Formularios compartidos se conservan al cambiar de subruta, no se sobrescriben por refetch y se reconstruyen o descartan al cambiar de identidad/salir de su ámbito.

## 7. Historial y cierre

Distinguir intención sin introducir otra entidad «vista»:

- `transition.to(route)`: ir a un destino concreto.
- `navigation.back()`: anterior entrada de historial válida de la app; fallback declarado si no existe.
- `close.self()`: cerrar el modal actual y resolver su ruta padre.

Propuesta de comportamiento:

1. Transición normal agrega entrada al historial; reemplazo se admite como política explícita cuando proceda.
2. Cerrar un modal revierte su entrada si fue abierto sobre el mismo padre dentro de la app.
3. En entrada directa o historial no compatible, cerrar reemplaza por la URL del padre. Nunca depender de un `history.back()` que podría sacar al usuario del sitio.
4. Navegar a una página elimina overlays incompatibles y compone los layouts del destino.
5. Recargar reconstruye el modal desde su URL: no se trata como estado efímero sin dirección.
6. Historial del navegador, enlace, Escape y botón de cierre respetan las políticas de navegación de la app. La salida completa del navegador y cierres de pestaña no pueden bloquearse con garantías absolutas.

El runtime resuelve foco, fondo inerte, cierre y formularios pendientes; el exportador muestra la política efectiva.

## 8. Estados no equivalen a rutas nuevas

- Loading, errores de negocio, vacío y contenido son variantes de una ruta/región.
- Pendiente/error de envío son variantes de la acción en esa ruta.
- Un selector o tooltip sigue siendo un control, no automáticamente una ruta.
- Un menú con flujo propio puede registrarse como lugar navegable cuando exista presentación `popover`; no forma parte de las presentaciones iniciales.
- Si un error lleva a otra ruta mediante un botón, se exportan la variante y su transición.

Esto conserva el vocabulario de lugares de Shape Up sin convertir cada cambio del DOM en navegación.

## 9. Exportación: árbol + grafo

El árbol describe contexto e identidad. Las transiciones forman un grafo, con ciclos y múltiples entradas:

```text
[Proyectos]
  ├── Crear → [Crear · modal sobre Proyectos]
  │             ├── cancelar → Proyectos
  │             └── guardar → projects.create
  │                 ├── error tipado → variante del modal
  │                 └── éxito → Detalle(result.id)
  └── seleccionar(id) → [Detalle(id)]
                          ├── volver → Proyectos
                          └── editar → [Editar · modal sobre Detalle]
                                          └── cerrar → Detalle
```

El exportador debe:

- Enumerar todas las rutas registradas, incluso sin enlaces de entrada, y señalar las inaccesibles desde la navegación inicial.
- Dibujar cada ruta con layouts, cabecera, fondo de modal y variantes.
- Hacer salir conexiones del botón/campo que las provoca, conservando identidad de origen y bindings.
- Mostrar las llamadas de servidor y continuaciones de éxito/error entre destinos.
- Mostrar relaciones inferidas entre operaciones y tablas como capa opcional.
- Mostrar proveedores/consumidores de contexto, contrato común de componentes reutilizados, identidad y duración del estado compartido como capa adicional.
- Representar rutas parametrizadas como plantillas, no expandir cada posible id.
- Conservar las ramas declaradas sin multiplicar todas las combinaciones de estados independientes.
- Reutilizar componentes sin convertir cada límite de componente en una nueva pantalla.

## 10. Comprobaciones del compilador y runtime

- Rutas y nombres estables; ningún destino sin registrar.
- Patrones ambiguos detectados; precedencia definida para segmentos estáticos frente a dinámicos (`new` no se interpreta como id).
- Codecs de parámetros compatibles con props; fallos de URL con representación conocida.
- Parámetros heredados sin colisiones silenciosas.
- Padres/contextos válidos para modales, sin ciclos estructurales.
- Rutas inexistentes con estado not-found global.
- Slots compatibles y componentes/acciones con referencias resueltas.
- Contexto compatible en todos los montajes de un componente; diagnóstico del acceso y montaje que falla.
- Proveedores heredados de rutas reconstruibles por URL y conservación/reset correcto del lifted state.
- Ramas condicionales no proporcionan contexto fuera de su ámbito.
- Modal directo → fondo correcto → cerrar al padre.
- Back/forward y recarga restauran el mismo contexto.

## Fuentes

- [Shape Up: Find the Elements](https://basecamp.com/shapeup/1.3-chapter-04)
- [Expo Router: Core concepts](https://docs.expo.dev/router/basics/core-concepts/)
- [Expo Router: Modals](https://docs.expo.dev/router/advanced/modals/)
