import { db, idx, nextGuia } from '../data/store.js';
import { PACKAGE_STATUS } from '../constants.js';
import { getCurrentUser } from './authService.js';
import { logAudit } from './auditService.js';
import { createVenta } from './salesService.js';

export function findOrCreateClient({ telefono, nombre, cedula = '', direccion = '' }) {
  const existing = idx.byTelefono().get(telefono);
  if (existing) return { client: existing, created: false };
  const c = { id: `c-${db.clientes.length + 1}`, telefono, nombre, cedula, direccion, historial: 'Nuevo' };
  db.clientes.push(c);
  logAudit({ modulo: 'clientes', accion: 'creacion_cliente', entidad: 'clientes', entidad_id: c.id, valor_nuevo: c });
  return { client: c, created: true };
}

export function createEnvio(payload) {
  const user = getCurrentUser();
  const { client } = findOrCreateClient(payload);
  const guia = nextGuia();
  const pkg = {
    id: `p-${db.paquetes.length + 1}`,
    guia,
    codigo_barras: `ASTRAPU-${guia.split('-')[1]}`,
    cliente_id: client.id,
    telefono_destinatario: payload.telefono,
    descripcion: payload.descripcion,
    color_empaque: payload.color_empaque,
    monto: Number(payload.monto),
    sucursal_origen: payload.sucursal_origen,
    sucursal_destino: payload.sucursal_destino,
    observacion: payload.observacion,
    estado: PACKAGE_STATUS.PENDIENTE,
    created_at: new Date().toISOString(),
    enviado_at: null,
    recibido_at: null,
    entregado_at: null,
    usuario_id: user.id,
    documento_fiscal_id: null,
  };
  db.paquetes.unshift(pkg);
  db.movimientos_paquete.unshift({
    id: crypto.randomUUID(), paquete_id: pkg.id, estado_origen: null, estado_destino: PACKAGE_STATUS.PENDIENTE,
    fecha_hora: pkg.created_at, usuario_id: user.id, sucursal_id: user.sucursal_id, detalle: 'Registro de envío',
  });
  createVenta(pkg, client);
  logAudit({ modulo: 'envios', accion: 'registro_envio', entidad: 'paquetes', entidad_id: pkg.id, valor_nuevo: pkg });
  return pkg;
}

function findByScan(code) {
  return idx.byBarcode().get(code) || idx.byGuia().get(code);
}

export function scanEnviar(code) {
  const p = findByScan(code);
  const user = getCurrentUser();
  if (!p) return { ok: false, message: 'Paquete no encontrado.' };
  if (p.estado !== PACKAGE_STATUS.PENDIENTE) return { ok: false, message: `Solo se puede enviar PENDIENTE. Estado actual: ${p.estado}` };
  const old = p.estado;
  p.estado = PACKAGE_STATUS.EN_TRANSITO;
  p.enviado_at = new Date().toISOString();
  db.movimientos_paquete.unshift({ id: crypto.randomUUID(), paquete_id: p.id, estado_origen: old, estado_destino: p.estado, fecha_hora: p.enviado_at, usuario_id: user.id, sucursal_id: user.sucursal_id, detalle: 'Cambio a en tránsito' });
  logAudit({ modulo: 'envios', accion: 'cambio_en_transito', entidad: 'paquetes', entidad_id: p.id, valor_anterior: old, valor_nuevo: p.estado });
  return { ok: true, data: p };
}

export function scanRecibir(code) {
  const p = findByScan(code);
  const user = getCurrentUser();
  if (!p) return { ok: false, message: 'Paquete no encontrado.' };
  if (p.estado !== PACKAGE_STATUS.EN_TRANSITO) return { ok: false, message: `Solo se puede recibir EN_TRANSITO. Estado actual: ${p.estado}` };
  const old = p.estado;
  p.estado = PACKAGE_STATUS.DISPONIBLE;
  p.recibido_at = new Date().toISOString();
  db.movimientos_paquete.unshift({ id: crypto.randomUUID(), paquete_id: p.id, estado_origen: old, estado_destino: p.estado, fecha_hora: p.recibido_at, usuario_id: user.id, sucursal_id: user.sucursal_id, detalle: 'Recepción de paquete' });
  logAudit({ modulo: 'recepcion', accion: 'recepcion_paquete', entidad: 'paquetes', entidad_id: p.id, valor_anterior: old, valor_nuevo: p.estado });
  return { ok: true, data: p };
}

export function searchPackagesByPhone(phone) {
  return db.paquetes.filter((p) => p.telefono_destinatario.includes(phone));
}

export function confirmDelivery({ paqueteId, cedula, scannedCode }) {
  const user = getCurrentUser();
  const p = db.paquetes.find((x) => x.id === paqueteId);
  if (!p) return { ok: false, message: 'Paquete no encontrado.' };
  const client = db.clientes.find((c) => c.id === p.cliente_id);
  if (p.estado !== PACKAGE_STATUS.DISPONIBLE) return { ok: false, message: 'El paquete no está disponible para entrega.' };
  if ((client?.cedula || '') !== cedula) {
    logAudit({ modulo: 'entrega', accion: 'cedula_incorrecta_entrega', entidad: 'paquetes', entidad_id: p.id, resultado: 'ERROR', observacion: 'Cédula no coincide' });
    return { ok: false, message: 'Cédula no coincide con destinatario.' };
  }
  if (scannedCode !== p.codigo_barras && scannedCode !== p.guia) {
    logAudit({ modulo: 'entrega', accion: 'escaneo_incorrecto_entrega', entidad: 'paquetes', entidad_id: p.id, resultado: 'ERROR', observacion: 'Escaneo final no coincide' });
    return { ok: false, message: 'Código escaneado no coincide con paquete seleccionado.' };
  }
  const old = p.estado;
  p.estado = PACKAGE_STATUS.ENTREGADO;
  p.entregado_at = new Date().toISOString();
  db.movimientos_paquete.unshift({ id: crypto.randomUUID(), paquete_id: p.id, estado_origen: old, estado_destino: p.estado, fecha_hora: p.entregado_at, usuario_id: user.id, sucursal_id: user.sucursal_id, detalle: 'Entrega confirmada' });
  logAudit({ modulo: 'entrega', accion: 'entrega_correcta', entidad: 'paquetes', entidad_id: p.id, valor_anterior: old, valor_nuevo: p.estado });
  return { ok: true, data: p };
}
