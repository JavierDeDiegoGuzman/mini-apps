# Contexto heredado, lifted state e inferencia

Estado: especificación de diseño vigente, no implementación. La semántica está acordada; la sintaxis de los constructores y la integración con TypeScript necesitan un prototipo. No se afirma que los fragmentos siguientes compilen hoy.

## 1. Decisión

Los componentes pueden acceder al contexto proporcionado por sus ancestros mediante:

```ts
ctx.ctx.ProjectDraft.fields.name
```

No se requiere `ctx.get(ProjectDraft)`, ni pasar bindings por cada componente/ruta intermedia. `ctx` es un constructor local tipado, no un singleton importado. `ctx.ctx` contiene referencias declarativas a capacidades del contexto heredado.

El padre decide qué proporciona. No se exponen automáticamente todas sus variables, recursos privados o props. El contexto puede incluir recursos reactivos, formularios y otras capacidades de interacción gestionadas por el DSL.

**Para un componente usado en varios lugares, el contrato accesible es la parte compatible común a todos sus montajes.** Cada montaje resuelve valores distintos contra sus propios ancestros.

## 2. Definición y montaje son diferentes

```text
Definición: ProjectName

Montaje A: ProjectDetail / Header / ProjectName
Montaje B: ProjectDetail / EditModal / ProjectName
```

Hay una definición reutilizable y dos posiciones del árbol. Cada posición tiene identidad propia, proveedores efectivos y ciclo de vida. No se guarda estado de una instancia en la definición compartida.

```text
Montaje A recibe: ProjectDraft, CurrentUser
Montaje B recibe: ProjectDraft, Permissions

ProjectName puede usar: ProjectDraft
No puede usar: CurrentUser ni Permissions
```

Añadir un montaje sin `ProjectDraft` solo hace inválido el componente si este intenta usarlo. Las claves que no utiliza no son requisitos. El diagnóstico señala la expresión consumidora y todos los montajes que no la satisfacen.

## 3. Parte común compatible

No es el tipo TypeScript `A & B`: esa intersección suele permitir miembros de ambos objetos, no solo las claves comunes.

Definición conceptual:

```text
Available(m) = contexto visible en el montaje m
Mounts(C) = todos los montajes estáticos posibles de la definición C
Common(C) = claves presentes y compatibles en cada Available(m)
Used(C) = accesos y capacidades realmente consumidos por C

Condición: Used(C) debe estar soportado por Common(C)
```

Reglas iniciales:

- Una clave ausente en cualquier montaje no es accesible en el contrato común.
- Coincidir en el nombre no basta: también debe coincidir el tipo de capacidad y su contrato.
- Formularios editables: exigir el mismo contrato de formulario (schema/codec de campos y capacidades). No unir formularios incompatibles ni comparar únicamente nombres de campos.
- Recursos reactivos: exigir un contrato compatible de datos, errores y operaciones disponibles. Como MVP, usar identidad/fingerprint del contrato normalizado, no una comparación estructural sofisticada.
- Los valores, argumentos de query y entidades concretas pueden diferir entre montajes aunque sus contratos coincidan.
- Contratos incompatibles se excluyen del contexto común y generan error si se consumen.
- No producir `any`, unión insegura ni fallback a undefined para hacer pasar una composición.

La restricción de identidad/fingerprint es deliberadamente conservadora. Una futura relajación puede permitir vistas read-only o subcontratos seguros, pero no se asume covarianza para datos que el hijo puede escribir.

Un componente sin montajes se valida como definición no enlazada y no tiene contexto heredado deducido. Para probarlo aislado se declara un fixture/provider, que funciona como montaje de prueba. No se inventa un contexto vacío como contrato definitivo de una biblioteca aún no montada.

## 4. Construcción tipada: top-down y bottom-up

El constructor puede pasar al componente un `ctx` cuyo contrato ya conoce. Ejemplo ilustrativo para composición inline:

```ts
const Editor = component("Editor")
  .provide({ ProjectDraft: draft })
  .build((ctx) =>
    ctx.ui.column([
      ctx.component("NameField", (ctx) =>
        ctx.ui.input(ctx.ctx.ProjectDraft.fields.name),
      ),
      ctx.ui.outlet(),
    ]),
  );
```

Los métodos exactos son provisionales. La fase `.provide(...)` establece información de tipo antes de comprobar el callback `.build(...)`.

Para una definición compartida, el objetivo es que su constructor reciba `Common(C)`, no el contexto más amplio del primer montaje encontrado. **No especializar silenciosamente una misma definición según cada padre.**

El compilador debe distinguir:

1. Árbol/grafo estructural: definiciones, montajes, rutas, proveedores y outlets.
2. Flujo top-down: calcular contexto disponible en cada posición.
3. Agrupación por definición: calcular el contrato común de todos sus montajes.
4. Consumos: registrar accesos a contextos y sus capacidades.
5. Flujo bottom-up: propagar requisitos pendientes; un proveedor compatible los satisface.
6. Validación final de todos los montajes y generación del manifiesto.

Esto no exige literalmente dos recorridos únicos: la construcción por etapas puede necesitar más pases. El compilador debe terminar de forma determinista, con errores de ciclos/contratos no resolubles en vez de ejecutar indefinidamente.

## 5. Evitar una dependencia circular del propio análisis

Si la estructura del árbol solo se descubre ejecutando cuerpos que ya necesitan el tipo del contexto común, aparece una dependencia circular de compilación.

Restricciones propuestas:

- Proveedores y sus contratos se registran en la fase estructural, antes de construir los cuerpos consumidores.
- Los recursos/formularios proporcionados tienen schemas conocidos sin consultar datos reales.
- Componentes y rutas tienen handles estables y sus referencias son inspeccionables antes del render real.
- Condiciones de UI conservan ambas ramas; las plantillas de listas conservan sus hijos. No decidir qué componentes existen mediante `if` arbitrarios sobre datos o presencia de contexto.
- La composición recursiva ilimitada no está soportada inicialmente. Los ciclos de transición entre rutas sí: no son ciclos de contención.
- Si el constructor necesita capturar una referencia todavía sin resolver, puede hacerlo como nodo simbólico para validación posterior; eso no implica que TypeScript ya conozca su tipo concreto.

El prototipo debe elegir entre construcción por etapas, captura simbólica y generación de tipos. No ocultar esta elección detrás de una firma genérica supuestamente mágica.

## 6. Qué puede inferir TypeScript y qué requiere el compilador

TypeScript puede:

- Tipar el parámetro de un callback cuando el builder ya conoce su contexto.
- Propagar requisitos/capacidades por tipos genéricos de nodos.
- Verificar campos y operaciones sobre contratos conocidos.
- Calcular tipos comunes de una estructura estática adecuadamente representada, dentro de límites prácticos de complejidad.

No puede retipar retroactivamente el cuerpo de una función independiente a partir de todos sus usos posteriores. Effect tampoco deduce un servicio desconocido desde su futuro proveedor: propaga un contrato de servicio ya conocido.

Por tanto, para componentes compartidos definidos por separado:

- La validación global del compilador es obligatoria.
- El autocompletado con contexto común requiere un orden de construcción que lo conozca antes de comprobar el cuerpo, o tipos generados desde el grafo.
- Un contrato explícito opcional puede ayudar a bibliotecas independientes, pero no es la API obligatoria `.requires(...)` que imponemos a toda app.
- Si se elige generación, sus archivos deben actualizarse al cambiar montajes; una comprobación completa rechaza tipos generados obsoletos.
- No prometer rechazo de todos los errores por `tsc` hasta validar el diseño con un prototipo y tests negativos.

## 7. Callbacks permitidos: solo de construcción

Se revisa la prohibición anterior de cualquier callback:

```text
Fuente TypeScript
  callback puro de construcción(ctx)
               ↓ compilación
  AST cerrado con referencias y ramas
               ↓
  runtime / wireframe
```

`.build((ctx) => ...)` recibe referencias y devuelve nodos. No lee datos reales del usuario, no conecta queries, no muta formularios y no se conserva como función en el manifiesto. La ejecución del runtime sigue siendo interpretación de tipos del DSL.

No se permiten handlers DOM, Effects arbitrarios, SQL libre, fetch ni closures de negocio ejecutadas ante eventos. Los builders de queries y acciones siguen proporcionando planes, no handlers de servidor.

El callback de construcción puede ejecutar JavaScript por naturaleza. La política «solo DSL» necesita validación de autoría de imports y sintaxis, además de validación del resultado. No confundir esa política con un sandbox para código de terceros.

## 8. Lifted state y ciclo de vida

Un proveedor posee instancias; los consumidores reciben handles, no copias.

- Recurso de query compartido: todos observan la misma instancia lógica; el runtime puede deduplicar suscripciones compatibles.
- Formulario compartido: editar un campo desde un hijo modifica el borrador del proveedor.
- No exponer datos de dominio como stores mutables alternativos al backend.
- Inicializar un formulario desde una query es una operación explícita: esperar resultado, crear borrador y no sobrescribirlo en cada actualización reactiva.

| Evento | Estado del proveedor |
|---|---|
| Navegar entre subrutas con el mismo ancestro e identidad | Se conserva |
| Abrir/cerrar modal hijo | Se conserva el proveedor padre |
| Cambiar un parámetro que forma parte de su identidad, p. ej. projectId | Nueva instancia; no reutilizar borrador del proyecto anterior |
| Salir de la rama propietaria | Liberar recursos y descartar estado efímero según política |
| Recargar/entrar por URL | Reconstruir proveedores desde rutas y parámetros |

Por defecto, los parámetros propios/heredados de identidad de la ruta forman parte de la clave de instancia; un cambio de filtro de un hijo no reinicia el padre. La API debe hacer visibles las excepciones a esta regla.

Borradores no sobreviven a recarga salvo persistencia declarada aparte. Los providers de componentes siguen su montaje real; si deben sobrevivir al reemplazo visual de una página, deben pertenecer al ámbito retenido de la ruta/layout, no a un fragmento que se desmonta.

## 9. Herencia en rutas y portales

Las subrutas heredan los providers de sus ancestros estructurales, aunque el cuerpo de la página padre sea sustituido. La configuración/provider de ruta puede seguir activo sin renderizar de nuevo ese cuerpo.

Un modal hereda el contexto de su padre canónico. Renderizarlo mediante un portal no rompe la herencia lógica. Entrar directamente a su URL reconstruye esos proveedores; no requiere haber visitado antes la página padre.

Las flechas de navegación no transmiten contexto del origen: una ruta destino solo recibe su contexto estructural. Esto evita que abrir el mismo modal desde dos botones cambie ocultamente sus dependencias.

Un proveedor condicional solo existe dentro de esa rama. Un componente montado también en otra rama sin proveedor falla si consume esa clave.

En el MVP, se rechaza sombrear una clave de contexto heredada con otro proveedor en la misma cadena. Proveedores de ramas independientes pueden usar el mismo nombre con contratos compatibles. Si más adelante se permite shadowing, tendrá que ser explícito y exportable.

## 10. Estados del recurso y capacidades

Compartir una query no demuestra que tenga datos. `ctx.ctx.Project` es un recurso con loading/errores/datos, no una fila siempre disponible.

- El consumidor representa sus estados, o una frontera declarada en un ancestro restringe el montaje a la rama de éxito.
- Las fronteras preservan la cobertura de errores tipados y aparecen en el wireframe.
- Los recursos, formularios y valores read-only son capacidades diferentes.
- El contexto nunca convierte un handle de servidor o un secreto en una capacidad de cliente.

## 11. Diagnósticos y wireframe

Ejemplo de diagnóstico esperado:

```text
CTX_MISSING: ProjectName usa ProjectDraft.fields.name
Montaje válido: /projects/:id → Header → ProjectName
Montaje inválido: /home → ProjectName
No existe proveedor ProjectDraft en /home.
```

El manifiesto incluye proveedores, identidad/lifetime, montajes, bindings de consumo y contrato común por definición. No necesita serializar el objeto ctx completo ni duplicar datos por consumidor.

El wireframe puede mostrar:

```text
Detalle(id) — proporciona Project y ProjectDraft
├── Header / ProjectName — consume ProjectDraft.name
└── Editar [modal] / ProjectName — consume el mismo borrador
    └── Guardar → backend → query Project actualizada
```

Se diferencian relaciones de navegación, dependencias de contexto y actualizaciones de datos. La vista principal puede ocultar esas capas de detalle, pero la exportación las conserva.

## 12. Criterios de aceptación

1. Componente inline recibe autocompletado de contexto tras `.provide`.
2. Un nombre/campo inexistente falla con diagnóstico de tipo o compilador, nunca undefined silencioso.
3. Dos montajes compatibles comparten contrato pero no instancias de estado entre ramas distintas.
4. Una clave presente en un solo montaje no puede consumirse desde la definición compartida.
5. Formularios con igual nombre y contratos incompatibles no se unifican.
6. Un contexto extra no consumido en un padre no impide reutilización.
7. Añadir un montaje inválido señala su ruta y el acceso consumidor.
8. Proveedor condicional no satisface consumidores fuera de su rama.
9. Cambiar de subruta conserva borrador; cambiar projectId lo reinicia.
10. Entrada directa a modal reconstruye proveedor y maneja carga/error.
11. Query compartida no duplica estado ni omite errores tipados.
12. El AST final no contiene callbacks y su exportación no ejecuta efectos externos.
13. Ciclos de transiciones terminan en referencias; ciclos de contención no soportados producen error.
14. El modo elegido de inferencia/generación pasa tests con `tsc`; documentar qué errores solo detecta `mini check`.

## Relacionados

- [DSL cerrado](./declarative-dsl.md)
- [Rutas y wireframes](./routing-and-wireframes.md)
- [Especificación resumida](../spec/README.md)
