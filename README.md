# Astrapu - Plataforma modular de paquetería (RD)

Esta versión implementa arquitectura modular con:
- Roles y permisos (Admin, Envíos, Entrega/Recibe, Contable solo lectura)
- Registro de envíos con autocompletado por teléfono
- Escaneo continuo enviar/recibir sin Enter
- Entrega con doble validación (cédula + escaneo final)
- Ventas, caja y cierre
- Auditoría inmutable desde UI (demo)
- Reportes + cálculo de tiempos por ruta
- Impresión QZ Tray (térmica + adhesiva)
- **Módulo fiscal propio desacoplado** con provider/adapter/repository/service/controller/mapper

## Reglas maestras aplicadas
- Guía interna independiente de numeración fiscal (`GUIA-000000001`).
- Documento fiscal desacoplado del flujo logístico.
- Credenciales/certificados solo en backend.

## Estructura
- `index.html`, `styles.css`, `src/*`: frontend operativo.
- `db/schema.sql`: modelo relacional actualizado.
- `server/fiscal/fiscalProvider.js`: contrato de proveedor fiscal.
- `server/fiscal/adapters/dgiiReferenceAdapter.js`: adapter de referencia DGII (encapsulado).
- `server/fiscal/fiscalMapper.js`: mapeo negocio -> payload fiscal.
- `server/fiscal/fiscalRepository.js`: persistencia fiscal.
- `server/fiscal/fiscalService.js`: flujos fiscales (XML/firma/envío/track/reintentos/eventos).
- `server/fiscal/fiscalController.js`: endpoints desacoplados.
- `server/config/fiscalConfig.js`: configuración segura por entorno.
- `docs/fiscal-dgii-reference.md`: análisis conceptual de `dgii-ecf`.
- `README_QZ.md`: guía de QZ Tray.

## Ejecución backend + frontend
1) Instalar dependencias:
```bash
npm install
```

2) Levantar API backend real:
```bash
npm run start
```

3) Levantar frontend estático (otra terminal):
```bash
python3 -m http.server 8080
```
Abrir `http://localhost:8080`.

## Nota de producción
- El backend ya usa SQLite real + RBAC server-side + auditoría append-only.
- La integración real DGII sigue en pausa por prioridad de hardening backend.
- `dgii-ecf` se usa solo como referencia/adaptador, no como núcleo del negocio.
