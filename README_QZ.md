# QZ Tray en Astrapu

## 1) Instalar QZ Tray
1. Descargar desde https://qz.io/download/
2. Instalar y abrir QZ Tray en la PC operativa.
3. Verificar icono activo en bandeja del sistema.

## 2) Configurar impresoras
1. Ir a **Configuración de impresoras** en el sistema.
2. Pulsar **Conectar QZ**.
3. Seleccionar:
   - Impresora térmica
   - Impresora adhesiva
4. Guardar configuración.

## 3) Probar impresión
- **Probar impresora térmica**: envía ticket ESC/POS.
- **Probar impresora adhesiva**: envía etiqueta ZPL.

## 4) Flujo principal integrado
- Registro de envío -> imprime ticket + etiqueta.
- Reimpresión último comprobante -> imprime ticket + etiqueta.
- Si falla una, se muestra error exacto y queda auditado.

## 5) Firma real en producción
- Punto pendiente: backend de message signing para QZ.
- Referencia interna: `qzService.signingMode = PENDIENTE_BACKEND_SIGNING`.
- Debe implementarse endpoint seguro para firmas antes de ambiente productivo final.
