import crypto from 'node:crypto';
import { run } from '../db/connection.js';

export async function writeAudit({ req, modulo, accion, entidad, entidadId = null, valorAnterior = null, valorNuevo = null, resultado = 'OK', observacion = '' }) {
  const user = req.user || {};
  await run(
    `INSERT INTO auditoria(id, fecha_hora, usuario_id, username, rol, sucursal_id, modulo, accion, entidad, entidad_id, valor_anterior, valor_nuevo, resultado, observacion, ip_equipo)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      crypto.randomUUID(),
      new Date().toISOString(),
      user.id || null,
      user.username || null,
      user.rol || null,
      user.sucursal_id || null,
      modulo,
      accion,
      entidad,
      entidadId,
      valorAnterior ? JSON.stringify(valorAnterior) : null,
      valorNuevo ? JSON.stringify(valorNuevo) : null,
      resultado,
      observacion,
      req.ip,
    ],
  );
}
