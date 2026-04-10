# Astrapu — Plataforma de Gestión de Paquetería Interprovincial RD

## Descripción
Sistema integral para la gestión de envíos de paquetes entre sucursales en la República Dominicana. Incluye autenticación por roles, flujo completo de paquetes (registro → envío → recepción → entrega), cierre de caja, auditoría inmutable, reportes, facturación electrónica (modo preparación) y soporte para impresión térmica/adhesiva vía QZ Tray.

## Stack técnico
- **Backend**: Node.js + Express.js (ES Modules), SQLite (via `sqlite3`), JWT (8h), Zod (validación), express-rate-limit
- **Frontend**: Vanilla JS ES Modules (sin framework), QZ Tray (impresión), Google Fonts (Inter)
- **Base de datos**: SQLite en `astrapu.sqlite`, migraciones en `server/db/migrations/001_init.sql` + `002_eta.sql`
- **IA**: `@google/genai` con Gemini 2.5 Flash vía Replit integration (`AI_INTEGRATIONS_GEMINI_BASE_URL` + `AI_INTEGRATIONS_GEMINI_API_KEY`)
- **Puerto**: 5000 (forzado via `PORT=5000 node server/index.js`)

## Roles y credenciales
| Rol | Usuario | Contraseña |
|-----|---------|------------|
| admin | admin | admin123 |
| envios | m.perez | envios123 |
| entrega | j.rodriguez | entrega123 |
| contable | contable | contable123 |

## Estructura de archivos clave
```
server/
  index.js              — Punto de entrada, inicia DB y servidor
  app.js                — Express app, monta todas las rutas
  db/
    connection.js       — Cliente SQLite + helper run/get/all + migrate() + seed usuarios
    migrations/001_init.sql — Schema completo
  routes/
    authRoutes.js       — Login/logout/me
    opsRoutes.js        — Operaciones: envíos, scan, búsqueda, entrega, ventas, cierres + GETs para sucursales/clientes/usuarios/paquetes
    adminRoutes.js      — CRUD admin: clientes, sucursales, usuarios, configuración
    auditRoutes.js      — Lectura auditoría (admin+contable)
    fiscalRoutes.js     — Facturación electrónica (modo preparación)
    printRoutes.js      — Config impresoras + QZ Tray signing
  middleware/
    auth.js             — JWT requireAuth, requireRole, forbidReadOnlyMutations
    validation.js       — validateBody(schema), validateParams(schema)
    rateLimit.js        — Limitadores por endpoint
  lib/
    audit.js            — writeAudit() — registro inmutable
    http.js             — sendOk/sendError helpers
  validation/
    schemas.js          — Todos los schemas Zod

src/
  app.js                — Orchestrador principal: login, render, wiring de todos los paneles
  views.js              — Renderizado de todas las vistas + viewState (filtros/estado por panel)
  constants.js          — MENUS (por rol), VIEW_LABELS, PACKAGE_STATUS
  data/store.js         — In-memory db (sincronizado desde backend en cada render)
  services/
    apiClient.js        — fetch wrapper con JWT, loginByRole()
    authService.js      — loginAs(), getCurrentUser(), canEdit()
    packageService.js   — Operaciones locales sobre paquetes (fallback)
    salesService.js     — createVenta(), resumenPendientes(), createCierre()
    auditService.js     — logAudit() local
    qzService.js        — QZ Tray connect, print, config impresoras
    printService.js     — printSaleDocuments() wrapper
    reportsService.js   — buildReports() con KPIs y tablas
    fiscalService.js    — Cliente REST del módulo fiscal
    routeEtaService.js  — Estimación ETA de rutas

index.html             — Shell HTML con sidebar, topbar, #appContent
styles.css             — CSS completo sin framework
```

## Arquitectura de datos
- El frontend mantiene un `db` en memoria (store.js) que se sobrescribe en cada `syncDataFromBackend()`
- `syncDataFromBackend()` llama en paralelo: ventas, paquetes, cierres, auditoría, sucursales, clientes, usuarios
- El `viewState` en views.js mantiene estado local de filtros/selección por panel

## APIs principales
- `POST /api/auth/login` — autenticación (rate limit: 5/15min)
- `GET /api/ops/sucursales` — lista sucursales
- `GET /api/ops/clientes[?search=]` — lista/busca clientes
- `GET /api/ops/usuarios` — lista usuarios (todos los roles)
- `GET /api/ops/paquetes` — lista paquetes con cliente_nombre
- `GET /api/ops/paquetes/:id` — detalle paquete
- `GET /api/ops/paquetes/:id/movimientos` — historial movimientos
- `POST /api/ops/envios` — registrar envío (idempotency key requerida)
- `POST /api/ops/paquetes/scan-send` — cambiar a EN_TRANSITO
- `POST /api/ops/paquetes/scan-receive` — cambiar a DISPONIBLE
- `GET /api/ops/paquetes/search?phone=` — buscar por teléfono
- `POST /api/ops/paquetes/delivery/session` — iniciar entrega (validar cédula)
- `POST /api/ops/paquetes/delivery/confirm` — confirmar entrega (validar escaneo)
- `GET /api/ops/ventas` — historial ventas
- `POST /api/ops/ventas/close` — cierre de caja
- `GET /api/auditoria` — auditoría con filtros y paginación
- `GET /api/admin/clientes[?search=]` + CRUD — gestión clientes
- `POST /api/admin/sucursales` + PUT — gestión sucursales
- `GET /api/admin/usuarios` + POST/PUT/PATCH toggle — gestión usuarios
- `GET/PUT /api/admin/config` — configuración general
- `GET /api/fiscal/status`, `POST /api/fiscal/config` — facturación
- `GET /api/impresion/config`, `PUT /api/impresion/config` — config impresoras
- `POST /api/impresion/qz/sign` — firma QZ Tray

## Funcionalidades implementadas
- ✅ Login multi-rol (selector en sidebar)
- ✅ Dashboard con KPIs clickables (filtran paquetes) + accesos rápidos
- ✅ Paquetes: lista con búsqueda + filtro por estado + detalle con historial de movimientos
- ✅ Clientes: búsqueda, crear, editar (admin)
- ✅ Sucursales: lista, crear, editar (admin)
- ✅ Usuarios: lista, crear, editar, activar/desactivar (admin)
- ✅ Cuadres: lista con detalle expandible + KPIs de cierre
- ✅ Auditoría: filtros funcionales (usuario, módulo, acción, fechas) + paginación
- ✅ Reportes: KPIs + tablas por sucursal, estado, ingresos, clientes frecuentes, tiempos de ruta
- ✅ Facturación: config form + lista documentos con acciones (XML, firmar, enviar)
- ✅ Configuración: form datos empresa + estado del sistema
- ✅ Nuevo envío: form con autocompletado de cliente por teléfono + impresión
- ✅ Escaneo enviar/recibir: scan en tiempo real con feedback
- ✅ Buscar paquete: búsqueda por teléfono + botón "Ir a entregar"
- ✅ Entregar paquete: flujo doble validación (cédula + escaneo)
- ✅ Cierre de caja: resumen pendientes + confirmación
- ✅ Impresoras: configuración QZ Tray + prueba térmica/adhesiva
- ✅ Mi historial + Perfil
- ✅ RBAC: contable=solo lectura, admin=todo, envios/entrega=operaciones

## Notas importantes
- La guía interna (GUIA-XXXXXXXXX) es independiente del número fiscal (NCF)
- El modo fiscal está en PREPARACIÓN — la integración DGII está desacoplada
- QZ Tray se firma en el backend (`/api/impresion/qz/sign`) para no exponer el secreto al frontend
- El contable tiene acceso de solo lectura total (forbidReadOnlyMutations en cada mutación)
- Rate limits: login 5/15min, operaciones de mutación 120/min, lectura 180/min
