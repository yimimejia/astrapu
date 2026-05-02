import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, withTransaction } from '../db/connection.js';
import { requireAuth, requireRole, forbidReadOnlyMutations } from '../middleware/auth.js';
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
      const sender = await findOrCreateClient(payload);

      // Destinatario opcional: si viene su teléfono, crear/buscar su ficha de cliente
      let receiver = null;
      if (payload.destinatario_telefono && payload.destinatario_telefono.replace(/\D/g, '').length >= 7) {
        receiver = await findOrCreateClient({
          telefono: payload.destinatario_telefono,
          nombre: payload.destinatario_nombre || 'Destinatario',
          cedula: payload.destinatario_cedula || '',
          direccion: payload.destinatario_direccion || '',
        });
      }
      const telDestinatario = receiver?.telefono || sender.telefono;

      const bultos = Math.max(1, Number(payload.bultos) || 1);
      const totalMonto = Number(payload.monto);
      const baseMonto = Math.round((totalMonto / bultos) * 100) / 100;
      const remainder = +(totalMonto - baseMonto * bultos).toFixed(2);

      const grupoId = bultos > 1 ? `grp-${crypto.randomUUID()}` : null;
      const now = new Date().toISOString();
      const paquetes = [];

      // Una sola guía base para todo el envío. Los bultos adicionales reusan ese número
      // con sufijo -1, -2, -3… tanto en la guía como en el código de barras, de modo que
      // el operador deba escanear códigos DIFERENTES por bulto (no puede repetir el mismo).
      const guiaBase = await nextGuia();                 // ej. GUIA-000000006
      const numero   = guiaBase.split('-')[1];           // ej. 000000006

      for (let i = 1; i <= bultos; i++) {
        const sufijo = i === 1 ? '' : `-${i - 1}`;
        const guia = `${guiaBase}${sufijo}`;             // GUIA-000000006, GUIA-000000006-1, …
        const codigoBarras = `ASTRAPU-${numero}${sufijo}`; // ASTRAPU-000000006, ASTRAPU-000000006-1, …
        const paqueteId = `p-${crypto.randomUUID()}`;
        const monto_i = i === 1 ? +(baseMonto + remainder).toFixed(2) : baseMonto;

        await run(
          `INSERT INTO paquetes(id, guia, codigo_barras, cliente_id, telefono_destinatario, descripcion, color_empaque, monto, sucursal_origen, sucursal_destino, estado, created_by, created_at, grupo_id, bulto_index, bulto_total)
           VALUES(?,?,?,?,?,?,?,?,?,?, 'PENDIENTE', ?, ?, ?, ?, ?)`,
          [paqueteId, guia, codigoBarras, sender.id, telDestinatario, payload.descripcion, payload.color_empaque, monto_i, payload.sucursal_origen, payload.sucursal_destino, req.user.id, now, grupoId, i, bultos],
        );

        await run(
          `INSERT INTO movimientos_paquete(id, paquete_id, estado_origen, estado_destino, usuario_id, sucursal_id, detalle, created_at)
           VALUES(?,?,?,?,?,?,?,?)`,
          [crypto.randomUUID(), paqueteId, null, 'PENDIENTE', req.user.id, req.user.sucursal_id, `Registro de envío (${i}/${bultos})`, now],
        );

        paquetes.push({ id: paqueteId, paquete_id: paqueteId, guia, codigo_barras: codigoBarras, bulto_index: i, bulto_total: bultos });
      }

      // Una sola venta por envío (referencia el primer paquete y registra el monto total)
      const primary = paquetes[0];
      const ventaId = `v-${crypto.randomUUID()}`;
      await run(
        `INSERT INTO ventas(id, paquete_id, guia, cliente_id, monto, metodo_pago, usuario_id, sucursal_id, created_at)
         VALUES(?,?,?,?,?,?,?, ?, ?)`,
        [ventaId, primary.id, primary.guia, sender.id, totalMonto, payload.metodo_pago || 'EFECTIVO', req.user.id, req.user.sucursal_id, now],
      );

      await writeAudit({ req, modulo: 'envios', accion: 'registro_envio', entidad: 'paquetes', entidadId: primary.id, valorNuevo: { guia: primary.guia, ventaId, bultos, grupoId } });

      return {
        // Compatibilidad con consumidores antiguos (un paquete)
        paquete_id: primary.id,
        guia: primary.guia,
        venta_id: ventaId,
        // Nuevos campos para multi-bulto
        grupo_id: grupoId,
        bultos,
        paquetes,
      };
    }),
  });

  res.json({ ok: true, data: result });
});

async function transitionByScan({ req, code, expectedState, newState, detail, auditAction, timestampField, branchField }) {
  return withTransaction(async () => {
    const paquete = await get('SELECT * FROM paquetes WHERE guia = ? OR codigo_barras = ?', [code, code]);
    if (!paquete) return { ok: false, error: 'Paquete no encontrado' };
    if (paquete.estado !== expectedState) return { ok: false, error: `Estado inválido: ${paquete.estado}` };

    // Branch ownership: admin opera cualquier sucursal, los operadores solo su sucursal asignada.
    if (branchField && req.user.rol !== 'admin') {
      const requiredBranch = paquete[branchField];
      if (requiredBranch && req.user.sucursal_id !== requiredBranch) {
        return { ok: false, error: 'Paquete no pertenece a tu sucursal' };
      }
    }

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

// Salida del paquete: solo `envios` (operador de despacho) o `admin`. Debe operar en sucursal_origen.
opsRoutes.post('/paquetes/scan-send', opsScanLimiter, forbidReadOnlyMutations, requireRole('admin', 'envios'), validateBody(scanSchema), async (req, res) => {
  const { code } = req.body;
  const result = await withIdempotency({ scope: 'scan_send', key: req.headers['x-idempotency-key'], refId: code, work: () => transitionByScan({ req, code, expectedState: 'PENDIENTE', newState: 'EN_TRANSITO', detail: 'Salida escaneada', auditAction: 'cambio_en_transito', timestampField: 'enviado_at', branchField: 'sucursal_origen' }) });
  if (result?.ok && result?.data) {
    const p = result.data;
    registerSampleStart(p.id, p.sucursal_origen, p.sucursal_destino).catch(() => {});
  }
  return sendResult(res, result, 'SCAN_REJECTED');
});

// Recepción: solo `entrega` (operador de la sucursal destino) o `admin`. Debe operar en sucursal_destino.
opsRoutes.post('/paquetes/scan-receive', opsScanLimiter, forbidReadOnlyMutations, requireRole('admin', 'entrega'), validateBody(scanSchema), async (req, res) => {
  const { code } = req.body;
  const result = await withIdempotency({ scope: 'scan_receive', key: req.headers['x-idempotency-key'], refId: code, work: () => transitionByScan({ req, code, expectedState: 'EN_TRANSITO', newState: 'DISPONIBLE', detail: 'Recepción escaneada', auditAction: 'recepcion_paquete', timestampField: 'recibido_at', branchField: 'sucursal_destino' }) });
  if (result?.ok && result?.data) {
    registerSampleEnd(result.data.id).catch(() => {});
  }
  return sendResult(res, result, 'SCAN_REJECTED');
});

opsRoutes.get('/paquetes/search', opsSearchLimiter, async (req, res) => {
  const phone  = String(req.query.phone || '').replace(/\D/g, '');
  const code   = String(req.query.code || '').trim();
  const cedula = String(req.query.cedula || '').trim();
  const onlyAvailable = req.query.only_available === '1';

  let rows;
  if (code) {
    rows = await all(
      `SELECT p.*, c.nombre as cliente_nombre, c.cedula
       FROM paquetes p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.guia = ? OR p.codigo_barras = ?
       ORDER BY p.created_at DESC LIMIT 5`,
      [code, code],
    );
  } else if (cedula) {
    // Buscar paquetes donde la cédula coincida con el REMITENTE (cliente_id)
    // o con el DESTINATARIO (clientes con esa cédula cuyo teléfono == telefono_destinatario).
    const matchingClients = await all('SELECT id, telefono FROM clientes WHERE cedula = ?', [cedula]);
    const ids = matchingClients.map((c) => c.id);
    const tels = matchingClients.map((c) => c.telefono).filter(Boolean);
    if (ids.length === 0) {
      rows = [];
    } else {
      const idPh = ids.map(() => '?').join(',');
      const telPh = tels.length ? tels.map(() => '?').join(',') : "''";
      rows = await all(
        `SELECT p.*, c.nombre as cliente_nombre, c.cedula
         FROM paquetes p JOIN clientes c ON c.id = p.cliente_id
         WHERE (p.cliente_id IN (${idPh})${tels.length ? ` OR p.telefono_destinatario IN (${telPh})` : ''})
         ${onlyAvailable ? "AND p.estado = 'DISPONIBLE'" : ''}
         ORDER BY p.created_at DESC LIMIT 50`,
        [...ids, ...tels],
      );
    }
  } else {
    rows = await all(
      `SELECT p.*, c.nombre as cliente_nombre, c.cedula
       FROM paquetes p JOIN clientes c ON c.id = p.cliente_id
       WHERE p.telefono_destinatario LIKE ?
       ORDER BY p.created_at DESC LIMIT 50`,
      [`%${phone}%`],
    );
  }
  await writeAudit({ req, modulo: 'entrega', accion: 'busqueda_sensible', entidad: 'paquetes', entidadId: code || cedula || phone || 'all' });
  res.json({ ok: true, data: rows });
});

opsRoutes.post('/paquetes/delivery/session', opsMutationLimiter, forbidReadOnlyMutations, requireRole('admin', 'entrega'), validateBody(startDeliverySchema), async (req, res) => {
  const { paquete_id, cedula } = req.body;
  const paquete = await get('SELECT p.*, c.cedula as cedula_cliente FROM paquetes p JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?', [paquete_id]);
  if (!paquete) return sendError(res, 404, 'NOT_FOUND', 'Paquete no encontrado');
  if (paquete.estado !== 'DISPONIBLE') return sendError(res, 400, 'INVALID_STATE', 'Paquete no disponible para entrega');

  // Sucursal de destino: admin opera cualquiera, otros solo su sucursal asignada
  if (req.user.rol !== 'admin' && paquete.sucursal_destino && req.user.sucursal_id !== paquete.sucursal_destino) {
    return sendError(res, 403, 'FORBIDDEN', 'Paquete no pertenece a tu sucursal de destino');
  }

  // La cédula puede ser del REMITENTE o del DESTINATARIO (cliente con cédula = X cuyo teléfono == telefono_destinatario)
  const cedulaSender = paquete.cedula_cliente || '';
  const receiver = await get('SELECT cedula FROM clientes WHERE telefono = ?', [paquete.telefono_destinatario]);
  const cedulaReceiver = receiver?.cedula || '';
  if (cedula !== cedulaSender && cedula !== cedulaReceiver) {
    await run('INSERT INTO failed_delivery_attempts(id, paquete_id, usuario_id, sucursal_id, motivo, expected_value, provided_value) VALUES(?,?,?,?,?,?,?)', [crypto.randomUUID(), paquete.id, req.user.id, req.user.sucursal_id, 'cedula_incorrecta', `${cedulaSender}|${cedulaReceiver}`, cedula || '']);
    await writeAudit({ req, modulo: 'entrega', accion: 'cedula_incorrecta_entrega', entidad: 'paquetes', entidadId: paquete.id, resultado: 'ERROR' });
    return sendError(res, 400, 'CEDULA_MISMATCH', 'Cédula no coincide');
  }

  const sessionId = `ds-${crypto.randomUUID()}`;
  await run('INSERT INTO delivery_sessions(id, paquete_id, usuario_id, sucursal_id, estado, validated_cedula, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)', [sessionId, paquete.id, req.user.id, req.user.sucursal_id, 'ESPERANDO_ESCANEO_FINAL', 1, new Date().toISOString(), new Date(Date.now() + 5 * 60 * 1000).toISOString()]);
  await writeAudit({ req, modulo: 'entrega', accion: 'intento_entrega', entidad: 'delivery_sessions', entidadId: sessionId, valorNuevo: { paquete_id } });
  res.json({ ok: true, data: { session_id: sessionId, estado: 'ESPERANDO_ESCANEO_FINAL' } });
});

opsRoutes.post('/paquetes/delivery/confirm', opsMutationLimiter, forbidReadOnlyMutations, requireRole('admin', 'entrega'), validateBody(confirmDeliverySchema), async (req, res) => {
  const { session_id, scanned_code } = req.body;

  const result = await withTransaction(async () => {
    const session = await get('SELECT * FROM delivery_sessions WHERE id = ?', [session_id]);
    if (!session || session.estado !== 'ESPERANDO_ESCANEO_FINAL') return { ok: false, error: 'Sesión inválida o expirada' };

    const paquete = await get('SELECT * FROM paquetes WHERE id = ?', [session.paquete_id]);
    if (!paquete) return { ok: false, error: 'Paquete no encontrado' };

    // Sucursal de destino: admin opera cualquiera, otros solo su sucursal asignada
    if (req.user.rol !== 'admin' && paquete.sucursal_destino && req.user.sucursal_id !== paquete.sucursal_destino) {
      return { ok: false, error: 'Paquete no pertenece a tu sucursal de destino' };
    }

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
