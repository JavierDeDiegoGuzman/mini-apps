# Wireframe esperado del ejemplo de componentes

Documento ilustrativo del resultado que produciría el exportador de `components.ts`. Está escrito manualmente para evaluar la propuesta; todavía no existe un exportador ni un runtime.

## Contrato del doble return

```ts
component("Nombre", (c) => {
  // 1. Declaración de dependencias. No conectar al servidor aquí.
  const items = c.query(api.items.list, {});

  // 2. c.render registra el contrato y DEVUELVE la función de presentación.
  return c.render(
    { queries: { items } },
    ({ queries }) => ui.query(queries.items, { /* todas las ramas */ }),
  );
});
```

Es decir: `setup → función de presentación`. El helper no renderiza inmediatamente ni introduce un tercer nivel de funciones. Permite inferir los parámetros y conservar información en runtime; una firma TypeScript sola no basta porque los tipos se borran.

Las funciones de presentación construyen nodos declarativos. `project.name`, los resultados futuros de acciones y los campos de formularios son referencias tipadas. Las transformaciones o condiciones sobre ellos deben usar operaciones soportadas; no se pueden tratar como valores JavaScript reales durante la construcción del árbol.

## Composición y navegación

```text
App
├── Header(user, home)
│   ├── Marca y enlace de inicio
│   ├── slot header.context
│   ├── slot header.actions
│   └── query session.me
├── Outlet
│   └── Projects | ProjectDetail(id)
└── Overlays
    └── modal(CreateProject)
```

- No hay un registro de vistas: el exportador empieza en `App` y recorre los destinos declarados.
- Los componentes tienen identidad estable; un destino parametrizado se exporta como plantilla, no una pantalla por cada id. Los ciclos se enlazan sin expandirlos infinitamente.
- Los componentes no alcanzables desde esa raíz no pertenecen a esta exportación.
- En este MVP solo existe un outlet de navegación. Una transición normal lo sustituye; `ui.modal` conserva el fondo.
- Los fills de la página activa completan la cabecera. Los modales no sustituyen esos fills.
- `ProjectCard` se integra en su padre; su límite de componente no implica otra pantalla.
- Crear cierra el modal y navega al detalle dentro del outlet que lo abrió. Cerrar restaura el foco al disparador; al navegar, el foco pasa al contenido nuevo.

## Mapa funcional

```text
                        APP + HEADER
                             │
                             ▼
                         PROYECTOS
                  ┌──────────┴───────────┐
          [Crear proyecto]        [Ver proyecto(id)]
                  │                      │
                  ▼                      ▼
             CREAR [modal]          DETALLE(id)
             │                           │
             ├── Cancelar → cerrar       └── Volver → PROYECTOS
             │
             └── Enviar
                 ├── inválido → errores de campos; no llamar servidor
                 └── projects.create
                     ├── pendiente → bloquear formulario y cierre
                     ├── fallo → conservar borrador, mostrar error
                     └── éxito → cerrar → DETALLE(result.id)

Global: [Mini Projects] → PROYECTOS
Queries lista/detalle: fallo → [Reintentar] → misma query
```

## Proyectos: estado con datos

```text
┌──────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos          [Crear proyecto]  Ana     │
├──────────────────────────────────────────────────────────────┤
│ Tus proyectos                                                │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Web pública                                              │ │
│ │ Nueva web para el estudio                                │ │
│ │ [Ver proyecto →]                                         │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ Repetir tarjeta por cada resultado de projects.list           │
└──────────────────────────────────────────────────────────────┘
```

«Ana» y «Web pública» son ejemplos de datos. Sin fixtures, aparecerían `[user.name]` y `[project.name]`.

### Variantes de la región lista

La cabecera y «Tus proyectos» permanecen.

```text
CARGA                     ERROR                      VACÍO
┌─────────────────────┐   ┌─────────────────────┐    ┌─────────────────────┐
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒      │   │ No se pudieron      │    │ Todavía no tienes   │
│ Lista de proyectos  │   │ cargar los proyectos│    │ proyectos           │
│                     │   │ [Reintentar]        │    │ [Crear el primero]  │
└─────────────────────┘   └─────────────────────┘    └─────────────────────┘
```

## Detalle: cambia el contenido contextual del mismo header

```text
┌──────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Detalle del proyecto       [Volver]  Ana     │
├──────────────────────────────────────────────────────────────┤
│ Web pública                                                  │
│ Nueva web para el estudio                                    │
└──────────────────────────────────────────────────────────────┘

Variantes del cuerpo:
  Carga     → placeholder «Detalle»
  Error     → «No se pudo cargar el proyecto» + [Reintentar]
  null      → «Proyecto no encontrado»
  Proyecto  → nombre y descripción

[Volver] está disponible en la cabecera en todas las variantes.
```

## Modal: composición sobre la lista

```text
┌──────────────────────────────────────────────────────────────┐
│ [Mini Projects]  Proyectos          [Crear proyecto]  Ana     │
├──────────────────────────────────────────────────────────────┤
│                 Página de fondo inerte                       │
│     ┌──────────────────────────────────────────────────┐     │
│     │ Crear proyecto                              [×]  │     │
│     │                                                  │     │
│     │ Nombre *                                         │     │
│     │ [__________________________________________]     │     │
│     │                                                  │     │
│     │ Descripción                                      │     │
│     │ [__________________________________________]     │     │
│     │ [__________________________________________]     │     │
│     │                                                  │     │
│     │              [Cancelar] [Crear proyecto]         │     │
│     └──────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

### Variantes del modal

| Estado | Presentación y comportamiento |
|---|---|
| Edición | Campos editables; cerrar descarta borrador |
| Inválido | «Escribe un nombre» junto al campo; no enviar |
| Pendiente | Campos, cancelar, × y Escape bloqueados; «Creando…» |
| Fallo | Valores conservados; mensaje de error; permite nuevo envío |
| Éxito | Cerrar y navegar al detalle; puede aparecer su carga inicial |

## Variantes compartidas

El usuario tiene su propio recurso, independiente del contenido del outlet:

- Carga: «Cargando usuario…».
- Error: «Usuario no disponible».
- Datos: nombre del usuario.

El exportador muestra estas variantes una vez, no multiplica cada pantalla por cada estado del usuario.

## Políticas pendientes de implementar

Las siguientes políticas son parte del runtime propuesto y el exportador debería mostrarlas resueltas:

- Formularios: validar antes del envío, conservar borrador en fallo y descartar al cerrar.
- Queries: suscribirse según argumentos; limpiar al desmontar; compartir recursos pasados a hijos.
- Reactividad: un nuevo resultado no provoca carga inicial; no se requiere invalidar manualmente tras crear.
- Conectividad: con datos anteriores, conservarlos y mostrar aviso de reconexión global; sin resultado inicial, mantener carga o mostrar error según el fallo.
- Mutación confirmada y query actualizada son eventos diferentes. No se presupone una actualización optimista.
- Modal: fondo inerte, foco atrapado y política de cierre coherente para botón, Escape y backdrop.
- Historial y URLs: no se especifican aún en este ejemplo. Las transiciones describen cambios de contenido, no una política de URL implícita.

## Pruebas que permitiría la separación

Pseudocódigo de una API de tests futura; no son pruebas ejecutadas:

```ts
// Contrato: sin navegador ni backend.
const definition = inspect(Projects);
expect(definition.queries.projects).toCall(api.projects.list);
expect(definition.actions.create).toOpenModal(CreateProject);

// Presentación: sustituir dependencias por escenarios.
const empty = preview(Projects, {
  queries: { projects: ready([]) },
});
expect(empty).toShowText("Todavía no tienes proyectos");
expect(empty).toOfferAction("create");

const failed = preview(Projects, {
  queries: { projects: failure(new Error("offline")) },
});
expect(failed).toShowText("No se pudieron cargar los proyectos");
expect(failed).toOfferRetry("projects");

// Contrato del formulario y continuación de éxito.
const create = inspect(CreateProject);
expect(create.actions.save).toValidateForm("project");
expect(create.actions.save).onSuccess.toCloseThenOpen(ProjectDetail, {
  id: resultRef("id"),
});
```

Estas pruebas separan contrato y presentación. Harían falta pruebas de integración adicionales para verificar el runtime, navegación real, accesibilidad y operaciones del backend.
