import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, withTransaction } from '../db/connection.js';
import { requireAuth, forbidReadOnlyMutations } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { withIdempotency } from '../lib/idempotency.js';
import { validateBody } from '../middleware/validation.js';
import { closeCashSchema, confirmDeliverySchema, registerEnvioSchema, scanSchema, startDeliverySchema } from '../validation/schemas.js';
import { sendError } from '../lib/http.js';
import { registerSampleStart, registerSampleEnd } from '../services/routeEtaService.js';
import { opsCloseLimiter, opsMutationLimiter, opsReadLimiter, opsScanLimiter, opsSearchLimiter } from '../middleware/rateLimit.js';

export const opsRoutes = Router();

opsRoutes.use(requireAuth);

function sendResult(res, result, fallbackCode = 'BUSINESS_RULE') {
  if (result.ok) return res.status(200).json(result);
  return sendError(res, 400, fallbackCode, result.error || 'Solicitud inválida');
}

async function findOrCreateClient({ telefono, nombre, cedula, direccion }) {
  const normalized = String(telefono || '').replace(/\D/g, '');
  let client = await get('SELECT * FROM clientes WHERE telefono = ?', [normalized]);
  if (client) return client;
  const id = `c-${crypto.randomUUID()}`;
  await run('INSERT INTO clientes(id, telefono, cedula, nombre, direccion) VALUES(?,?,?,?,?)', [id, normalized, cedula || null, nombre, direccion || null]);
  client = await get('SELECT * FROM clientes WHERE id = ?', [id]);
  return client;
}

async function nextGuia() {
  const seq = await get('SELECT * FROM secuencias_guias WHERE id = ?', ['seq-guia-1']);
  const value = seq.valor_actual + 1;
  await run('UPDATE secuencias_guias SET valor_actual = ?, updated_at = ? WHERE id = ?', [value, new Date().toISOString(), 'seq-guia-1']);
  return `GUIA-${String(value).padStart(9, '0')}`;
}

opsRoutes.post('/envios', opsMutationLimiter, forbidReadOnlyMutations, validateBody(registerEnvioSchema), async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  const result = await withIdempotency({
    scope: 'register_envio',
    key: idempotencyKey,
    work: async () => withTransaction(async () => {
      const payload = req.body;
      const client = await findOrCreateClient(payload);
      const guia = await nextGuia();
      const paqueteId = `p-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      await run(
        `INSERT INTO paquetes(id, guia, codigo_barras, cliente_id, telefono_destinatario, descripcion, color_empaque, monto, sucursal_origen, sucursal_destino, estado, created_by, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?, 'PENDIENTE', ?, ?)`,
        [paqueteId, guia, `ASTRAPU-${guia.split('-')[1]}`, client.id, client.telefono, payload.descripcion, payload.color_empaque, Number(payload.monto), payload.sucursal_origen, payload.sucursal_destino, req.user.id, now],
      );

      const ventaId = `v-${crypto.randomUUID()}`;
      await run(
        `INSERT INTO ventas(id, paquete_id, guia, cliente_id, monto, metodo_pago, usuario_id, sucursal_id, created_at)
         VALUES(?,?,?,?,?,?,?, ?, ?)`,
        [ventaId, paqueteId, guia, client.id, Number(payload.monto), payload.metodo_pago || 'EFECTIVO', req.user.id, req.user.sucursal_id, now],
      );

      await run(
        `INSERT INTO movimientos_paquete(id, paquete_id, estado_origen, estado_destino, usuario_id, sucursal_id, detalle, created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), paqueteId, null, 'PENDIENTE', req.user.id, req.user.sucursal_id, 'Registro de envío', now],
      );

      await writeAudit({ req, modulo: 'envios', accion: 'registro_envio', entidad: 'paquetes', entidadId: paqueteId, valorNuevo: { guia, ventaId } });
      return { paquete_id: paqueteId, venta_id: ventaId, guia };
    }),
  });

  res.json({ ok: true, data: result });
});

async function transitionByScan({ req, code, expectedState, newState, detail, auditAction, timestampField }) {
  return withTransaction(async () => {
    const paquete = await get('SELECT * FROM paquetes WHERE guia = ? OR codigo_barras = ?', [code, code]);
    if (!paquete) return { ok: false, error: 'Paquete no encontrado' };
    if (paquete.estado !== expectedState) return { ok: false, error: `Estado inválido: ${paquete.estado}` };

    const now = new Date().toISOString();
    const updated = await run(
      `UPDATE paquetes SET estado = ?, ${timestampField} = ?, version = version + 1 WHERE id = ? AND estado = ?`,
      [newState, now, paquete.id, expectedState],
    );

    if (!updated.changes) return { ok: false, error: 'Conflicto de concurrencia, reintentar.' };

    await run(
      `INSERT INTO movimientos_paquete(id, paquete_id, estado_origen, estado_destino, usuario_id, sucursal_id, detalle, created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), paquete.id, expectedState, newState, req.user.id, req.user.sucursal_id, detail, now],
    );

    await writeAudit({ req, modulo: 'paquetes', accion: auditAction, entidad: 'paquetes', entidadId: paquete.id, valorAnterior: { estado: expectedState }, valorNuevo: { estado: newState } });
    return { ok: true, data: { ...paquete, estado: newState } };
  });
}

opsRoutes.post('/paquetes/scan-send', opsScanLimiter, forbidReadOnlyMutations, validateBody(scanSchema), async (req, res) => {
  const { code } = req.body;
  const result = await withIdempotency({ scope: 'scan_send', key: req.headers['x-idempotency-key'], refId: code, work: () => transitionByScan({ req, code, expectedState: 'PENDIENTE', newState: 'EN_TRANSITO', detail: 'Salida escaneada', auditAction: 'cambio_en_transito', timestampField: 'enviado_at' }) });
  if (result?.ok && result?.data) {
    const p = result.data;
    registerSampleStart(p.id, p.sucursal_origen, p.sucursal_destino).catch(() => {});
  }
  return sendResult(res, result, 'SCAN_REJECTED');
});

opsRoutes.post('/paquetes/scan-receive', opsScanLimiter, forbidReadOnlyMutations, validateBody(scanSchema), async (req, res) => {
  const { code } = req.body;
  const result = await withIdempotency({ scope: 'scan_receive', key: req.headers['x-idempotency-key'], refId: code, work: () => transitionByScan({ req, code, expectedState: 'EN_TRANSITO', newState: 'DISPONIBLE', detail: 'Recepción escaneada', auditAction: 'recepcion_paquete', timestampField: 'recibido_at' }) });
  if (result?.ok && result?.data) {
    registerSampleEnd(result.data.id).catch(() => {});
  }
  return sendResult(res, result, 'SCAN_REJECTED');
});

opsRoutes.get('/paquetes/search', opsSearchLimiter, async (req, res) => {
  const phone = String(req.query.phone || '').replace(/\D/g, '');
  const rows = await all('SELECT p.*, c.nombre as cliente_nombre, c.cedula FROM paquetes p JOIN clientes c ON c.id = p.cliente_id WHERE p.telefono_destinatario LIKE ? ORDER BY p.created_at DESC LIMIT 50', [`%${phone}%`]);
  await writeAudit({ req, modulo: 'entrega', accion: 'busqueda_sensible', entidad: 'paquetes', entidadId: phone || 'all' });
  res.json({ ok: true, data: rows });
});

opsRoutes.post('/paquetes/delivery/session', opsMutationLimiter, forbidReadOnlyMutations, validateBody(startDeliverySchema), async (req, res) => {
  const { paquete_id, cedula } = req.body;
  const paquete = await get('SELECT p.*, c.cedula as cedula_cliente FROM paquetes p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?', [paquete_id]);
  if (!paquete) return sendError(res, 404, 'NOT_FOUND', 'Paquete no encontrado');
  if (paquete.estado !== 'DISPONIBLE') return sendError(res, 400, 'INVALID_STATE', 'Paquete no disponible para entrega');

  if ((paquete.cedula_cliente || '') !== cedula) {
    await run('INSERT INTO failed_delivery_attempts(id, paquete_id, usuario_id, sucursal_id, motivo, expected_value, provided_value) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), paquete.id, req.user.id, req.user.sucursal_id, 'cedula_incorrecta', paquete.cedula_cliente || '', cedula || '']);
    await writeAudit({ req, modulo: 'entrega', accion: 'cedula_incorrecta_entrega', entidad: 'paquetes', entidadId: paquete.id, resultado: 'ERROR' });
    return sendError(res, 400, 'CEDULA_MISMATCH', 'Cédula no coincide');
  }

  const sessionId = `ds-${crypto.randomUUID()}`;
  await run('INSERT INTO delivery_sessions(id, paquete_id, usuario_id, sucursal_id, estado, validated_cedula, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)', [sessionId, paquete.id, req.user.id, req.user.sucursal_id, 'ESPERANDO_ESCANEO_FINAL', 1, new Date().toISOString(), new Date(Date.now() + 5 * 60 * 1000).toISOString()]);
  await writeAudit({ req, modulo: 'entrega', accion: 'intento_entrega', entidad: 'delivery_sessions', entidadId: sessionId, valorNuevo: { paquete_id } });
  res.json({ ok: true, data: { session_id: sessionId, estado: 'ESPERANDO_ESCANEO_FINAL' } });
});

opsRoutes.post('/paquetes/delivery/confirm', opsMutationLimiter, forbidReadOnlyMutations, validateBody(confirmDeliverySchema), async (req, res) => {
  const { session_id, scanned_code } = req.body;

  const result = await withTransaction(async () => {
    const session = await get('SELECT * FROM delivery_sessions WHERE id = ?', [session_id]);
    if (!session || session.estado !== 'ESPERANDO_ESCANEO_FINAL') return { ok: false, error: 'Sesión inválida o expirada' };

    const paquete = await get('SELECT * FROM paquetes WHERE id = ?', [session.paquete_id]);
    if (!paquete) return { ok: false, error: 'Paquete no encontrado' };

    if (scanned_code !== paquete.guia && scanned_code !== paquete.codigo_barras) {
      await run('INSERT INTO failed_delivery_attempts(id, paquete_id, usuario_id, sucursal_id, motivo, expected_value, provided_value) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), paquete.id, req.user.id, req.user.sucursal_id, 'escaneo_final_incorrecto', `${paquete.guia}/${paquete.codigo_barras}`, scanned_code]);
      await writeAudit({ req, modulo: 'entrega', accion: 'escaneo_incorrecto_entrega', entidad: 'paquetes', entidadId: paquete.id, resultado: 'ERROR' });
      return { ok: false, error: 'Escaneo final no coincide' };
    }

    const now = new Date().toISOString();
    const updated = await run(`UPDATE paquetes SET estado='ENTREGADO', entregado_at = ?, version = version + 1 WHERE id = ? AND estado = 'DISPONIBLE'`, [now, paquete.id]);
    if (!updated.changes) return { ok: false, error: 'Conflicto de estado en entrega' };

    await run('UPDATE delivery_sessions SET estado = ? WHERE id = ?', ['COMPLETADA', session.id]);
    await run('INSERT INTO movimientos_paquete(id, paquete_id, estado_origen, estado_destino, usuario_id, sucursal_id, detalle, created_at) VALUES(?,?,?,?,?,?,?,?)', [crypto.randomUUID(), paquete.id, 'DISPONIBLE', 'ENTREGADO', req.user.id, req.user.sucursal_id, 'Entrega confirmada', now]);
    await writeAudit({ req, modulo: 'entrega', accion: 'entrega_correcta', entidad: 'paquetes', entidadId: paquete.id, valorAnterior: { estado: 'DISPONIBLE' }, valorNuevo: { estado: 'ENTREGADO' } });
    return { ok: true, data: { paquete_id: paquete.id, estado: 'ENTREGADO' } };
  });

  return sendResult(res, result, 'DELIVERY_REJECTED');
});

opsRoutes.get('/ventas', opsReadLimiter, async (req, res) => {
  const rows = await all('SELECT v.*, c.nombre as cliente_nombre FROM ventas v JOIN clientes c ON c.id = v.cliente_id ORDER BY v.created_at DESC LIMIT 200');
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/paquetes', opsReadLimiter, async (req, res) => {
  const rows = await all(
    `SELECT p.*, c.nombre as cliente_nombre
     FROM paquetes p
     JOIN clientes c ON c.id = p.cliente_id
     ORDER BY p.created_at DESC
     LIMIT 300`,
  );
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/cierres', opsReadLimiter, async (req, res) => {
  const rows = await all('SELECT * FROM cierres_caja ORDER BY created_at DESC LIMIT 100');
  res.json({ ok: true, data: rows });
});

opsRoutes.post('/ventas/close', opsCloseLimiter, forbidReadOnlyMutations, validateBody(closeCashSchema), async (req, res) => {
  const result = await withTransaction(async () => {
    const pending = await all('SELECT * FROM ventas WHERE usuario_id = ? AND sucursal_id = ? AND cierre_id IS NULL', [req.user.id, req.user.sucursal_id]);
    if (!pending.length) return { ok: false, error: 'No hay ventas pendientes para cierre' };

    const totals = pending.reduce((acc, v) => {
      acc.total += v.monto;
      if (v.metodo_pago === 'EFECTIVO') acc.efectivo += v.monto;
      else if (v.metodo_pago === 'TRANSFERENCIA') acc.transferencia += v.monto;
      else if (v.metodo_pago === 'TARJETA') acc.tarjeta += v.monto;
      else acc.otros += v.monto;
      return acc;
    }, { total: 0, efectivo: 0, transferencia: 0, tarjeta: 0, otros: 0 });

    const cierreId = `cc-${crypto.randomUUID()}`;
    const contado = Number(req.body.monto_contado || 0);
    const diff = contado - totals.efectivo;
    await run(`INSERT INTO cierres_caja(id, usuario_id, sucursal_id, total_general, total_efectivo_esperado, total_transferencia, total_tarjeta, total_otros, monto_contado, diferencia, observacion, created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [cierreId, req.user.id, req.user.sucursal_id, totals.total, totals.efectivo, totals.transferencia, totals.tarjeta, totals.otros, contado, diff, req.body.observacion || null, new Date().toISOString()]);

    for (const v of pending) {
      await run('UPDATE ventas SET cierre_id = ? WHERE id = ? AND cierre_id IS NULL', [cierreId, v.id]);
      await run('INSERT INTO cierre_ventas(cierre_id, venta_id) VALUES(?,?)', [cierreId, v.id]);
    }

    await writeAudit({ req, modulo: 'caja', accion: 'creacion_cierre', entidad: 'cierres_caja', entidadId: cierreId, valorNuevo: { ventas: pending.length, total: totals.total } });
    return { ok: true, data: { cierre_id: cierreId, diferencia: diff, cantidad_ventas: pending.length } };
  });

  return sendResult(res, result, 'CLOSE_REJECTED');
});

opsRoutes.get('/failed-delivery-attempts', opsReadLimiter, async (req, res) => {
  const rows = await all('SELECT * FROM failed_delivery_attempts ORDER BY created_at DESC LIMIT 200');
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/sucursales', opsReadLimiter, async (_req, res) => {
  const rows = await all('SELECT * FROM sucursales ORDER BY nombre ASC');
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/clientes', opsReadLimiter, async (req, res) => {
  const search = String(req.query.search || '').trim();
  let rows;
  if (search) {
    rows = await all(
      `SELECT * FROM clientes WHERE nombre LIKE ? OR telefono LIKE ? OR cedula LIKE ? ORDER BY nombre ASC LIMIT 100`,
      [`%${search}%`, `%${search}%`, `%${search}%`],
    );
  } else {
    rows = await all('SELECT * FROM clientes ORDER BY nombre ASC LIMIT 500');
  }
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/usuarios', opsReadLimiter, async (_req, res) => {
  const rows = await all('SELECT id, username, nombre, rol, sucursal_id, activo, created_at FROM usuarios ORDER BY rol, nombre ASC');
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/paquetes/:id/movimientos', opsReadLimiter, async (req, res) => {
  const rows = await all(
    `SELECT m.*, u.username FROM movimientos_paquete m LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.paquete_id = ? ORDER BY m.created_at ASC`,
    [req.params.id],
  );
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/mi-auditoria', opsReadLimiter, async (req, res) => {
  const rows = await all(
    'SELECT * FROM auditoria WHERE usuario_id = ? ORDER BY fecha_hora DESC LIMIT 100',
    [req.user.id],
  );
  res.json({ ok: true, data: rows });
});

opsRoutes.get('/paquetes/:id', opsReadLimiter, async (req, res) => {
  const row = await get(
    `SELECT p.*, c.nombre as cliente_nombre, c.telefono as cliente_telefono, c.cedula as cliente_cedula
     FROM paquetes p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?`,
    [req.params.id],
  );
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Paquete no encontrado');
  res.json({ ok: true, data: row });
});
