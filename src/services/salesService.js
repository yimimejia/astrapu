import { db } from '../data/store.js';
import { getCurrentUser } from './authService.js';
import { logAudit } from './auditService.js';

export function createVenta(pkg, client) {
  const user = getCurrentUser();
  const venta = {
    id: `v-${db.ventas.length + 1}`,
    paquete_id: pkg.id,
    guia: pkg.guia,
    cliente: client.nombre,
    telefono: client.telefono,
    monto: pkg.monto,
    metodo_pago: 'EFECTIVO',
    fecha_hora: new Date().toISOString(),
    usuario_id: user.id,
    sucursal_id: user.sucursal_id,
    cierre_id: null,
  };
  db.ventas.unshift(venta);
  logAudit({ modulo: 'ventas', accion: 'creacion_venta', entidad: 'ventas', entidad_id: venta.id, valor_nuevo: venta });
  return venta;
}

export function ventasPendientesUsuario() {
  const user = getCurrentUser();
  return db.ventas.filter((v) => v.usuario_id === user.id && v.sucursal_id === user.sucursal_id && !v.cierre_id);
}

export function resumenPendientes() {
  const data = ventasPendientesUsuario();
  const total = data.reduce((a, b) => a + b.monto, 0);
  const efectivo = data.filter((x) => x.metodo_pago === 'EFECTIVO').reduce((a, b) => a + b.monto, 0);
  const transferencia = data.filter((x) => x.metodo_pago === 'TRANSFERENCIA').reduce((a, b) => a + b.monto, 0);
  const tarjeta = data.filter((x) => x.metodo_pago === 'TARJETA').reduce((a, b) => a + b.monto, 0);
  const otros = total - efectivo - transferencia - tarjeta;
  return { cantidad: data.length, total, efectivo, transferencia, tarjeta, otros };
}

export function createCierre({ monto_contado, observacion }) {
  const user = getCurrentUser();
  const ventas = ventasPendientesUsuario();
  const resumen = resumenPendientes();
  const cierre = {
    id: `cc-${db.cierres_caja.length + 1}`,
    usuario_id: user.id,
    sucursal_id: user.sucursal_id,
    fecha_hora: new Date().toISOString(),
    cantidad_ventas: ventas.length,
    total_general: resumen.total,
    total_efectivo_esperado: resumen.efectivo,
    total_transferencia: resumen.transferencia,
    total_tarjeta: resumen.tarjeta,
    total_otros: resumen.otros,
    monto_contado: Number(monto_contado),
    observacion,
    diferencia: Number(monto_contado) - resumen.efectivo,
  };
  db.cierres_caja.unshift(cierre);
  ventas.forEach((v) => {
    v.cierre_id = cierre.id;
    db.cierre_ventas.push({ cierre_id: cierre.id, venta_id: v.id });
  });
  logAudit({ modulo: 'caja', accion: 'creacion_cierre', entidad: 'cierres_caja', entidad_id: cierre.id, valor_nuevo: cierre });
  return cierre;
}
