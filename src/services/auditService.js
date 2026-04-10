import { db } from '../data/store.js';
import { getCurrentUser } from './authService.js';

export function logAudit({ modulo, accion, entidad, entidad_id, valor_anterior = null, valor_nuevo = null, resultado = 'OK', observacion = '' }) {
  const user = getCurrentUser();
  db.auditoria.unshift({
    id: crypto.randomUUID(),
    fecha_hora: new Date().toISOString(),
    usuario: user.username,
    rol: user.rol,
    sucursal: user.sucursal_id,
    modulo,
    accion,
    entidad,
    entidad_id,
    valor_anterior,
    valor_nuevo,
    resultado,
    observacion,
    ip_equipo: 'LOCAL-UI',
  });
}
