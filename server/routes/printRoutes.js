import { Router } from 'express';
import crypto from 'node:crypto';
import { get, run } from '../db/connection.js';
import { requireAuth, requireRole, forbidReadOnlyMutations } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { validateBody } from '../middleware/validation.js';
import { printerConfigSchema, qzSignSchema } from '../validation/schemas.js';
import { printLimiter } from '../middleware/rateLimit.js';
import { sendOk } from '../lib/http.js';

export const printRoutes = Router();

printRoutes.use(printLimiter);
printRoutes.use(requireAuth);

printRoutes.get('/config', async (req, res) => {
  let cfg = await get('SELECT * FROM configuracion_impresoras WHERE sucursal_id = ?', [req.user.sucursal_id]);
  if (!cfg) {
    const id = `cfg-print-${req.user.sucursal_id}`;
    await run('INSERT INTO configuracion_impresoras(id, sucursal_id) VALUES(?,?)', [id, req.user.sucursal_id]);
    cfg = await get('SELECT * FROM configuracion_impresoras WHERE id = ?', [id]);
  }
  return sendOk(res, cfg);
});

printRoutes.put('/config', forbidReadOnlyMutations, validateBody(printerConfigSchema), async (req, res) => {
  const { impresora_termica, impresora_adhesiva } = req.body;
  const now = new Date().toISOString();
  const cfg = await get('SELECT * FROM configuracion_impresoras WHERE sucursal_id = ?', [req.user.sucursal_id]);
  if (!cfg) {
    await run('INSERT INTO configuracion_impresoras(id, sucursal_id, impresora_termica, impresora_adhesiva, updated_at) VALUES(?,?,?,?,?)', [`cfg-print-${req.user.sucursal_id}`, req.user.sucursal_id, impresora_termica, impresora_adhesiva, now]);
  } else {
    await run('UPDATE configuracion_impresoras SET impresora_termica = ?, impresora_adhesiva = ?, updated_at = ? WHERE sucursal_id = ?', [impresora_termica, impresora_adhesiva, now, req.user.sucursal_id]);
  }
  await writeAudit({ req, modulo: 'impresion', accion: 'configuracion_impresoras', entidad: 'configuracion_impresoras', entidadId: req.user.sucursal_id, valorNuevo: { impresora_termica, impresora_adhesiva } });
  return sendOk(res, { updated: true });
});

// Endpoint de signing para QZ Tray (sin exponer secreto al frontend)
printRoutes.post('/qz/sign', requireRole('admin', 'envios', 'entrega', 'contable'), validateBody(qzSignSchema), async (req, res) => {
  const payload = req.body.payload;
  const secret = process.env.QZ_SIGN_SECRET || 'astrapu-dev-qz-sign';
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64');
  await writeAudit({ req, modulo: 'impresion', accion: 'qz_sign', entidad: 'qz_sign', entidadId: req.user.id });
  return sendOk(res, { signature });
});
