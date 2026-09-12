# Plan exploratorio: composición y reactividad

Estado: propuesta de experimentación, no decisión vigente ni API implementada. No sustituye todavía `context-and-inference.md` ni los requisitos CTX de `spec/README.md`. Su objetivo es comparar dos modelos antes de reescribir la spec.

## 1. Preguntas que queremos resolver

- ¿Podemos componer UI con requisitos inferidos de Effect y providers explícitos sin construir un framework demasiado complejo?
- ¿Resulta más comprensible un modelo estilo Foldkit: Model → view y Message → update?
- ¿Qué coste tiene cada opción para identidad, estado compartido, carga/error y exportación del wireframe?

Usar helpers sin JSX es una preferencia común a las dos alternativas. Adoptar ese estilo visual no obliga a adoptar la arquitectura de Foldkit, ni usar Effect obliga a convertir el render en un Effect.

## 2. Caso funcional común

Implementar la misma pantalla en ambos prototipos:

1. Seleccionar un projectId y cargar un proyecto mediante una API simulada.
2. Representar carga inicial, error de negocio, fallo de transporte y éxito.
3. Mostrar nombre y descripción en componentes separados, con un contenedor intermedio.
4. Actualizar el nombre remotamente e invalidar la query.
5. Mantener los datos durante refetch y representar un fallo de actualización sin ocultarlo.
6. Cambiar rápidamente de proyecto, con respuestas que llegan fuera de orden.
7. Montar dos paneles de proyectos distintos simultáneamente.
8. Introducir después un pequeño borrador local: escribir, refrescar y comprobar que no se sobrescribe.

El borrador es una prueba de estrés posterior, no un compromiso de modelar formularios completos en esta fase.

No implementar inicialmente backend Cloudflare, SQL, router completo, SSR, persistencia offline ni componentes recursivos. Simular el transporte y las invalidaciones externas de forma determinista.

## 3. Alternativa A: componentes Effect + Atom + providers

### Contrato de autoría a probar

- Una dependencia declara identidad y contrato; no se identifica solo por el tipo estructural del dato.
- El componente consume servicios mediante Effect; sus requisitos se infieren.
- Las props son argumentos explícitos de funciones que producen componentes.
- Los helpers de contenedores combinan los requisitos de sus hijos.
- Un provider explícito satisface una dependencia en su subárbol lógico.
- La frontera asíncrona discrimina estados y entrega un dato disponible a su rama de éxito.
- El componente consumidor recibe un valor de dominio normal, no el recurso ni un atom.

Ejemplo conceptual; `CurrentProject` sería un servicio tipado de Effect y `ui.*` APIs por implementar:

```ts
const ProjectContent = Effect.gen(function* () {
  const project = yield* CurrentProject;
  return ui.heading(project.name);
});

const page = ui.async(projectResource, {
  loading: ui.text("Cargando…"),
  error: projectErrorUi,
  success: (project) =>
    ui.provider(CurrentProject, project, ProjectContent),
});
```

No consolidar todavía `Component<R> = Effect<UiNode, never, R>`: primero demostrar que los contenedores y providers conservan R, que se pueden identificar montajes y que el protocolo de render no introduce esperas accidentales. `never` en el canal de error tipado no impide defectos ni efectos externos.

### Runtime propuesto

- Atom describe estado y cálculos derivados.
- AtomRegistry mantiene valores, dependencias, suscripciones y recursos de atoms.
- AsyncResult representa resultado asíncrono y actualización en curso.
- Reactivity conecta invalidaciones por claves con recargas. Es local: un adaptador convierte eventos del transporte en invalidaciones del registry/runtime correspondiente.
- El runtime UI mantiene identidades de montaje, ámbitos de providers y suscripciones de fronteras.
- Una frontera observa el atom del recurso. En éxito proporciona un snapshot del dato y evalúa el subárbol con ese servicio.
- Una actualización reevalúa inicialmente todo el subárbol del provider. No implementar seguimiento fino por consumidor en la primera iteración.
- Reevaluar no significa remontar: el renderer conserva nodos con identidad compatible y aplica los cambios.

Un `yield* CurrentProject` no crea por sí mismo una suscripción a un atom. El puente es la frontera/provider que observa la fuente y programa una nueva evaluación.

### Restricciones del render

Los Effects de componentes sirven inicialmente para leer servicios de presentación y construir UI. Las peticiones, escrituras y recursos duraderos pertenecen a servicios/acciones gestionados fuera del render. No ejecutar una petición cada vez que se evalúa un componente.

Probar una evaluación síncrona del render; rechazar suspensión accidental con un diagnóstico claro. No intentar resolver render concurrente/asíncrono en el MVP. Esta es una restricción de autoría/runtime, no una garantía proporcionada por el tipo Effect.

### Identidad y lifecycle

- Separar definición de componente, montaje, recurso y evaluación.
- Un recurso se identifica por operación, argumentos normalizados y ámbito pertinente; documentar la deduplicación elegida.
- Crear recursos fuera de reevaluaciones o retenerlos mediante identidad estable de montaje.
- Los providers de dos ramas pueden tener valores distintos para el mismo servicio sin contaminación.
- Rechazar inicialmente sombreado en una misma cadena para conservar una resolución inequívoca.
- Cancelar/liberar observaciones al salir del ámbito; ignorar respuestas obsoletas aunque el transporte no pueda cancelarlas.
- Cambio de projectId crea una nueva identidad de entidad. Un refetch del mismo proyecto no debe reiniciar el borrador ni el montaje de éxito.
- Usar un registry aislado por app/prueba; la política de estado compartido por rutas se pospone hasta demostrar este caso mínimo.

## 4. Alternativa B: arquitectura estilo Foldkit

No es simplemente cambiar la sintaxis de componentes. Cambia la propiedad y evolución del estado:

```text
Message → update(Model, Message) → nuevo Model + Commands
                                   ↓
                               view(Model)
```

- Model contiene selección, estado de carga, datos y posteriormente borrador.
- Los eventos y los resultados de Commands generan Messages.
- update decide todas las transiciones; view es pura y no ejecuta Effects.
- Las peticiones se ejecutan como Commands. Las invalidaciones externas entran como Messages mediante una Subscription.
- Las vistas hijas reciben datos ya refinados al seleccionar la rama de éxito en la vista padre.
- Comparar la composición real de submodels y delegación de mensajes, no solo una pantalla monolítica.

Probar preferentemente el runtime real de Foldkit antes de replicar su arquitectura. Verificar las APIs de su versión fijada y su compatibilidad con la versión de Effect elegida; no asumir que ambas coinciden con la última v4.

Evaluar cuánto código de Model/Message/update exige la pantalla y si ofrece una ventaja clara para pruebas, trazabilidad y formularios. No añadir providers a esta alternativa de entrada: comprobar primero si submodels, argumentos de vistas y composición normal resultan suficientes.

No mezclar un Model autoritativo con atoms mutables que mantengan otra copia de los mismos datos. Si después se estudia una combinación, debe haber un único propietario de cada estado.

## 5. Fases y entregables

### Fase 0 — Fijar terreno

- Crear proyectos aislados `prototypes/effect-ui/` y `prototypes/foldkit-ui/`, con dependencias y lockfiles fijados.
- Comprobar disponibilidad y firmas reales de Effect v4 `unstable/reactivity` y la versión compatible de Foldkit.
- Definir fixtures, API simulada, scheduler controlable y lista común de transiciones.
- Registrar qué afirmaciones de la spec actual quedan en evaluación, sin cambiarlas todavía.

Salida: ambos proyectos ejecutables y una matriz común de casos.

### Fase 1 — Probar tipos de composición en A, sin DOM

- Consumo de un servicio con requisito inferido.
- Composición de dos hijos con requisitos distintos sin borrar ninguno.
- Provider que elimina solo el requisito satisfecho.
- Props comprobadas, dato incompatible rechazado y requisito pendiente al cerrar la raíz rechazado.
- Mismo componente montado en dos ámbitos con valores distintos.
- Helpers utilizables sin `any`, casts públicos o listas manuales de requisitos transitivos.

Salida: tests positivos y negativos con `tsc`, y un renderer textual para inspeccionar el resultado. Si no resulta ergonómico, revisar antes de implementar reactividad.

### Fase 2 — Slice reactivo A

- Query simulada como atom asíncrono y frontera de estados.
- Provider y reevaluación síncrona del subárbol.
- Renderer DOM mínimo con identidad estable, contenedores, texto y botón; evaluar reutilizar un renderer existente antes de ampliarlo.
- Invalidación manual y evento externo simulado.
- Instrumentar peticiones, evaluaciones, montajes, suscripciones y liberaciones.

Salida: caso funcional común sin borrador y sin fugas ni peticiones duplicadas por render.

### Fase 3 — Slice equivalente B

- Implementar Model, Messages, update, Commands y view sobre Foldkit.
- Incluir dos vistas hijas y al menos una composición de submodel que revele el coste de delegación.
- Reproducir los mismos escenarios de query, invalidación y carreras.
- Instrumentar las transiciones y el lifecycle con métricas comparables, sin equiparar literalmente render con patch DOM.

Salida: segunda demo funcional y comparación del código de autoría.

### Fase 4 — Pruebas de estrés y wireframe

- Añadir el pequeño borrador a ambas versiones.
- Probar retención durante refetch, cambio de entidad y dos instancias simultáneas.
- Probar éxito vacío/null cuando el contrato lo permita: éxito no significa automáticamente una entidad no nullable.
- Exportar al menos carga, error y éxito como variantes, sin ejecutar peticiones.
- Evaluar explícitamente qué información estructural se conserva y qué requiere fixtures/metadatos adicionales.

Un callback ejecutado con datos actuales y un Effect arbitrario no permiten enumerar todas las ramas estáticas. Tampoco una view pura de Foldkit garantiza esa enumeración. No presentar capturas de fixtures como una prueba de exhaustividad.

Salida: demos, tests y lista de límites reales de exportación.

### Fase 5 — Decisión y actualización de documentos

Redactar un ADR con el modelo elegido, evidencia, costes y lo que se descarta. Solo entonces actualizar `docs/context-and-inference.md`, `docs/declarative-dsl.md`, `docs/README.md` y `spec/README.md`.

Si A gana: sustituir contexto común global por requisitos inferidos y providers explícitos; especificar reevaluación y lifecycle. Si B gana: especificar Model/Message/update, composición de submodels y qué parte del DSL cerrado conservamos. En ambos casos resolver expresamente si sigue siendo obligatorio un AST serializable exhaustivo.

## 6. Pruebas de aceptación comunes

1. B solo recibe un proyecto cuando hay datos admitidos por la frontera.
2. Carga inicial y refetch con datos previos tienen comportamientos distintos.
3. Un fallo de refetch no desaparece visualmente ni borra datos sin una política explícita.
4. Una respuesta tardía de proyecto A no sustituye el proyecto B seleccionado después.
5. Dos montajes no mezclan datos ni borradores.
6. Un refetch no duplica peticiones por reevaluar vistas ni remonta el subárbol estable.
7. Salir de la pantalla libera sus recursos observables según la política de caché declarada.
8. Un dato actualizado llega a los consumidores sin repetir gestión de loading/error en ellos.
9. El borrador se conserva durante actualizaciones remotas y se reinicia al cambiar de entidad.
10. El origen de cada actualización puede explicarse con trazas reproducibles.
11. La exportación distingue lo probado con fixtures de lo garantizado estructuralmente.
12. Tests de A verifican requisitos con `tsc`; los tests de B verifican transiciones y composición de mensajes/submodels.

## 7. Criterios para elegir

| Criterio | A: Effect + Atom | B: estilo Foldkit |
|---|---|---|
| Composición de dependencias | Medir inferencia y ergonomía de providers | Medir paso de datos y composición de submodels |
| Reactividad | Medir complejidad del puente provider/evaluación | Medir complejidad de Messages/update/Commands |
| Estado local | Medir identidad, propiedad y retención | Medir estructura del Model y transiciones |
| Depuración | Trazas de invalidación, evaluación y montaje | Trazas de mensajes y cambios del Model |
| Infraestructura propia | Renderer/adaptador y runtime UI | Adaptación del runtime y DSL a Foldkit |
| Wireframe | Requiere estructura declarativa adicional | Requiere estructura declarativa adicional |

No decidir por el contador más corto ni por familiaridad con `yield*`. Elegir después de mantener el mismo caso con carga, errores, refetch, dos instancias y edición local. Si ninguna opción conserva razonablemente la exportación exigida, comparar una tercera opción de AST estático con referencias reactivas o revisar ese requisito antes de seguir.

## Referencias

- [Foldkit: arquitectura](https://foldkit.dev/core/architecture)
- [Foldkit: view](https://foldkit.dev/core/view)
- [Effect v4: Atom](https://www.effect.website/docs/v4/api/effect/unstable/reactivity/Atom)
- [Effect v4: Reactivity](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/unstable/reactivity/Reactivity.ts)
- [Effect v4: AsyncResult](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/unstable/reactivity/AsyncResult.ts)

Fuentes consultadas para orientar el plan; la fase 0 debe fijar versiones porque las APIs y los enlaces a main pueden cambiar.
