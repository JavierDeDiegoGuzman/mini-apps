# Especificación del framework · estado actual

Estado: contrato de diseño, todavía no implementado. MUST / MUST NOT son requisitos del diseño objetivo, no garantías del código actual. Los ejemplos de `examples/` anteriores son históricos; las APIs exactas de builders aún requieren prototipo.

## APP · Definición y compilación

- **APP-01:** Una app MUST tener un único export raíz, componible desde módulos de definiciones.
- **APP-02:** El compilador MUST producir artefactos separados de servidor, cliente y revisión. El cliente MUST NOT importar el archivo fuente completo ni confiar en tree-shaking para proteger código/secretos.
- **APP-03:** El manifiesto MUST ser un AST versionado y cerrado, sin funciones, getters, closures o capacidades ejecutables opacas.
- **APP-04:** Se permiten callbacks puros de construcción con contexto tipado. MUST producir solo nodos y desaparecer antes del runtime. No se permiten handlers de negocio arbitrarios.
- **APP-05:** Imports/sintaxis de autoría y AST final MUST validarse. Este mecanismo no constituye aislamiento de código no confiable.

## DSL · Builders y tipos

- **DSL-01:** Queries, acciones de servidor, componentes, acciones de cliente, rutas y expresiones MUST tener tipos de nodo específicos con capacidades restringidas.
- **DSL-02:** Query/action implementation MUST ser un plan, construido mediante API encadenable estilo Drizzle; no un handler de servidor ni SQL libre.
- **DSL-03:** UI MUST construirse con helpers estilo Foldkit. No se requiere su arquitectura Model/Message/update ni el doble return de Remix.
- **DSL-04:** Parámetros, resultados, elementos y contextos MUST conservar identidad, contrato y ámbito. Referencias fuera de ámbito MUST rechazarse.
- **DSL-05:** Resultados, codecs, errores y dependencias MUST derivarse de planes; no exigir contratos input/success/error duplicados por defecto.
- **DSL-06:** Tipos y validación global del AST se complementan. MUST NOT sustituir información desconocida por `any` o casts para aparentar inferencia completa.

## DATA · Datos y operaciones

- **DATA-01:** El backend es la autoridad de datos de dominio. El cliente puede mantener caché gestionada y estado efímero de interacción.
- **DATA-02:** Queries MUST ser de lectura. Acciones de servidor MUST ejecutar su plan de escritura en una transacción sin efectos externos.
- **DATA-03:** Acciones MUST devolver datos o NoContent; MUST NOT usar null para señalizar fallo. Queries opcionales pueden declarar ausencia explícita.
- **DATA-04:** Errores de negocio MUST tener schemas/tags y tratamiento visual exhaustivo, local o compartido explícitamente.
- **DATA-05:** Validación, transporte y defectos internos MUST tener políticas distintas de errores de negocio; no filtrar detalles internos.
- **DATA-06:** Al confirmar escrituras, el runtime MUST invalidar conservadoramente las queries activas que lean tablas afectadas. Fallos/rollback MUST NOT publicar invalidaciones de datos no confirmados.
- **DATA-07:** Datos y versiones MUST leerse en el mismo snapshot. SSE inicial, refetch y reconexión MUST evitar perder cambios; mantener resultados anteriores durante actualización.
- **DATA-08:** Efectos durables MUST NOT depender exclusivamente de memoria/Fibers. Recibos, eventos y cambios se coordinan transaccionalmente según el adaptador.

## ROUTE · Vistas y navegación

- **ROUTE-01:** Vista y ruta MUST ser una sola entidad. El árbol registra qué componentes son destinos; los componentes embebidos no son rutas por sí mismos.
- **ROUTE-02:** Presentación MUST pertenecer al destino. Las acciones MUST NOT escoger `.asModal()`.
- **ROUTE-03:** Rutas MUST tener parámetros/URL tipados. Modal direccionable MUST reconstruir su fondo canónico desde su padre incluso al entrar directamente.
- **ROUTE-04:** Un hijo página puede sustituir el cuerpo visible del padre sin descartar sus layouts y proveedores de ruta retenidos.
- **ROUTE-05:** Transiciones forman un grafo distinto del árbol de contención. Una transición MUST NOT heredar contexto del origen por el mero hecho de venir de él.
- **ROUTE-06:** Cerrar, volver y navegar a destino MUST tener políticas explícitas de historial/fallback. Cerrar modal directo MUST poder resolver su padre sin salir accidentalmente de la app.

## CTX · Contexto común por componente

- **CTX-01:** El acceso público objetivo es `ctx.ctx.ProjectDraft.fields.name`; no requiere bindings manuales por cada nivel.
- **CTX-02:** Los ancestros MUST proporcionar explícitamente las capacidades compartidas. MUST NOT exponer automáticamente todas sus variables privadas.
- **CTX-03:** Definición de componente y montaje MUST tener identidades diferentes. Un componente puede montarse varias veces con valores/estado distintos.
- **CTX-04:** El contrato accesible a una definición compartida MUST contener solo las claves compatibles presentes en todos sus montajes posibles del árbol compilado.
- **CTX-05:** El componente MUST consumir únicamente capacidades soportadas por ese contrato común. Claves extra no consumidas en un padre no invalidan la composición.
- **CTX-06:** La parte común MUST NOT implementarse ingenuamente como `A & B`. Formularios mutables requieren contrato compatible conservador; igualdad de nombre no basta.
- **CTX-07:** Proveedores satisfacen requisitos en su subárbol lógico, incluidos outlets y portales. Proveedores condicionales no satisfacen ramas externas.
- **CTX-08:** El MVP MUST rechazar sombreado de claves en una misma cadena de ancestros. Ramas independientes pueden proporcionar el mismo nombre con valores diferentes.
- **CTX-09:** El compilador MUST calcular disponibilidad top-down, agrupar montajes y calcular contexto común, y propagar/verificar requisitos bottom-up. No se exige un número fijo de recorridos.
- **CTX-10:** Las declaraciones estructurales/proveedores MUST poder descubrirse sin datos reales. No permitir árboles ocultos por condicionales JS arbitrarios ni recursión de contención ilimitada.
- **CTX-11:** La API de construcción SHOULD pasar el ctx común tipado al constructor. Para definiciones independientes el prototipo MUST determinar si necesita etapas o generación de tipos; MUST NOT prometer retipado retroactivo de funciones por TypeScript.
- **CTX-12:** Recurso compartido MUST conservar estados de carga/error/datos. Su acceso MUST NOT implicar automáticamente éxito.
- **CTX-13:** El proveedor posee formularios/recursos. Cambiar entre hijos mantiene la instancia del padre; salir de su ámbito o cambiar su identidad la libera/reemplaza.
- **CTX-14:** Recargar MUST reconstruir providers desde rutas/params. Los borradores no persisten salvo política explícita, y actualizaciones remotas no sobrescriben silenciosamente ediciones locales.
- **CTX-15:** Contextos de cliente MUST NOT transportar secretos ni capacidades de ejecución de servidor.

## REVIEW · Wireframe y diagnóstico

- **REVIEW-01:** Exportar todas las rutas, variantes y conexiones desde elementos de interacción, incluidas continuaciones y errores.
- **REVIEW-02:** Exportar opcionalmente dependencias de API/tablas y proveedores/consumidores de contexto, con identidad y duración del estado compartido.
- **REVIEW-03:** Plantillas parametrizadas y ciclos de navegación MUST representarse mediante referencias, no expansión infinita.
- **REVIEW-04:** Un error de contexto MUST identificar definición, acceso y montaje incompatible. Añadir un montaje inválido MUST fallar aunque otros montajes sean válidos.

## CLOUD · Primer destino

- **CLOUD-01:** Runtime implementado con Effect v4, versión exacta fijada y adaptador verificado.
- **CLOUD-02:** Primer destino Cloudflare Worker + Durable Object persistente por app/entorno, sin plataforma multiusuario propia.
- **CLOUD-03:** SQLite-backed DO es decisión del adaptador, no requisito del DSL ni archivo local exigido a la app.
- **CLOUD-04:** CLI delega publicación a Wrangler. Demos sin auth de negocio MUST estar protegidas por una barrera de acceso real.

## Verificación y cuestiones abiertas

Los casos de [contexto e inferencia §12](../docs/context-and-inference.md) son pruebas de aceptación obligatorias antes de estabilizar la API. Se añaden a pruebas de transacción, reconexión y despliegue de los documentos de runtime.

Abierto: firma exacta del constructor que recibe el árbol, orden de etapas, handles para referencias adelantadas, tipo común generado frente a inferido por TypeScript y límites de complejidad del análisis. El contrato semántico de contexto común no queda abierto.

Referencia de detalle: [índice de docs](../docs/README.md).
