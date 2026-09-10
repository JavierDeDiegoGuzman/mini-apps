# Diseño del mini framework

Estado: propuesta, no implementación. Los comandos `mini` y las APIs propias que aparecen aquí todavía no existen. Los comandos Wrangler sí pertenecen a Cloudflare, pero requieren generar e implementar antes los artefactos descritos.

## Objetivo

Definir aplicaciones pequeñas mediante componentes componibles y backend declarativo. Una misma representación permite ejecutar la app y exportar un wireframe con contenido, variantes, operaciones y conexiones entre pantallas.

## Documentos

1. [DSL cerrado: componentes, queries y acciones](./declarative-dsl.md)
2. [Rutas = vistas y exportación del wireframe](./routing-and-wireframes.md)
3. [Contexto heredado, lifted state e inferencia](./context-and-inference.md)
4. [Backend y runtime en Effect v4](./backend-effect-v4.md)
5. [Persistencia, reactividad y Cloudflare Durable Objects](./cloudflare-runtime.md)
6. [CLI, desarrollo y despliegue](./cli-deployment.md)
7. [Especificación resumida y requisitos verificables](../spec/README.md)

Los tres primeros documentos son la referencia vigente de autoría. Los ejemplos siguientes son históricos: su doble return, `view` y presentación en componentes no describen ya la API objetivo. Ahora se permiten callbacks puros de construcción, no sus handlers de runtime ni lógica opaca. Conservan valor como casos funcionales a migrar:

- [Componentes con doble return](../examples/components.ts)
- [Wireframe de componentes](../examples/components-wireframe.md)
- [Todo list completo](../examples/03-todos.md)

## Decisiones de partida

- Una única raíz exportada de aplicación; artefactos de servidor, cliente y revisión separados por el compilador.
- Componentes componibles como definiciones cerradas de props, recursos, formularios, acciones y UI; sin doble return ni handlers de aplicación.
- Builders de queries/escrituras estilo Drizzle, UI estilo Foldkit y acciones componibles: construyen tipos específicos del DSL, no ejecutan lógica arbitraria.
- Inputs explícitos; resultados, schemas, errores tipados y dependencias inferidos desde los planes.
- Cobertura visual exhaustiva de errores de negocio, comprobada con tipos y validación del grafo.
- Vista y ruta son la misma entidad. El árbol registra componentes como destinos y define layouts, parámetros y presentación.
- La presentación modal pertenece a la ruta de destino; nunca a la acción que la abre. Su padre define el fondo canónico también al entrar por URL.
- UI, queries, escrituras y transiciones producen nodos inspeccionables y serializables. Se permiten callbacks puros de construcción con ctx tipado; no quedan funciones, Effects ni SQL arbitrarios en el contrato/runtime.
- Acceso a contexto mediante `ctx.ctx.ProjectDraft...`; los padres proporcionan capacidades explícitas sin reenviarlas por cada nivel.
- Un componente reutilizado solo puede consumir el contexto compatible común entre todos sus montajes. Cada montaje resuelve sus propios valores/estado.
- Análisis top-down de disponibilidad y bottom-up de requisitos, con validación global del árbol. TypeScript no retipa retroactivamente componentes independientes; etapas/generación se decidirán con un prototipo.
- Recursos y formularios compartidos pertenecen a su proveedor: persisten entre subrutas del mismo ámbito, no entre entidades diferentes ni tras recarga salvo política explícita.
- Backend implementado con Effect v4; las aplicaciones no necesitan escribir Effects para CRUD.
- Datos de dominio autoritativos en el servidor; borradores e interacción gestionados en cliente.
- Invalidación por tablas y refetch de queries activas.
- SSE como transporte inicial; interfaz de transporte reemplazable.
- Primer destino: Cloudflare Worker + Durable Object con almacenamiento persistente.
- Primer modelo de aislamiento: un objeto de datos por app y entorno, dentro de un despliegue propio.
- Sin control plane, cuentas, billing, marketplace ni ejecución de código de terceros en un runtime compartido.
- Autenticación de negocio aplazada. Acceso de red restringido para demos: no desplegar una API de escritura abierta accidentalmente.

## Qué queda abierto

Sintaxis exacta de builders/handles y constructor del árbol, generación frente a inferencia de tipos del contexto común, versión exacta de Effect v4, cliente SQL del adaptador, detalle de historial/guards, paginación y operaciones compuestas. El modelo ruta=vista con URLs y contexto canónico de modales sí queda acordado. Las APIs concretas se decidirán mediante pequeños prototipos y tests de contrato.

SQLite no es un requisito del lenguaje de la app. El adaptador propuesto de Cloudflare utiliza el almacenamiento SQLite-backed de Durable Objects: es una capacidad gestionada del proveedor, no un archivo local suministrado por la app.
