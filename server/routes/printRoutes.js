import { Router } from 'express';
import crypto from 'node:crypto';
import { get, run } from '../db/connection.js';
import { requireAuth, requireRole, forbidReadOnlyMutations } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { validateBody } from '../middleware/validation.js';
import { printerConfigSchema, qzSignSchema } from '../validation/schemas.js';
import { printLimiter } from '../middleware/rateLimit.js';
import { sendOk, sendError } from '../lib/http.js';

export const printRoutes = Router();

printRoutes.use(printLimiter);

// ─── CERTIFICADO PÚBLICO QZ TRAY ─────────────────────────────────────────────
// Este endpoint devuelve la clave pública RSA que QZ Tray usará para
// verificar la autenticidad de la app. No requiere autenticación porque
// QZ Tray lo llama antes de establecer la sesión.
// La clave pública está almacenada en QZ_PUBLIC_KEY (variable de entorno).
printRoutes.get('/qz/cert', (_req, res) => {
  const cert = process.env.QZ_PUBLIC_KEY;
  if (!cert) {
    return res.status(503).type('text/plain').send('');
  }
  // QZ Tray espera el certificado como texto plano
  res.type('text/plain').send(cert.replace(/\\n/g, '\n'));
});

// ─── DESCARGA DEL CERTIFICADO PARA QZ TRAY ────────────────────────────────────
// El usuario descarga este archivo una sola vez y lo agrega en QZ Tray
// (Site Manager → Add certificate). Después QZ Tray nunca vuelve a pedir permiso.
printRoutes.get('/qz/cert/download', (_req, res) => {
  const cert = process.env.QZ_PUBLIC_KEY;
  if (!cert) {
    return sendError(res, 503, 'NO_CERT', 'Certificado no configurado');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="astrapu-qztray.crt"');
  res.type('text/plain').send(cert.replace(/\\n/g, '\n'));
});

// ─── AUTENTICACIÓN REQUERIDA PARA EL RESTO ────────────────────────────────────
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

// ─── FIRMA RSA-SHA512 PARA QZ TRAY ────────────────────────────────────────────
// QZ Tray llama a setSignaturePromise con un string a firmar.
// El frontend llama a este endpoint para obtener la firma.
// La clave privada NUNCA sale del servidor (QZ_PRIVATE_KEY en env vars).
// QZ Tray verifica la firma contra el certificado público que ya conoce.
printRoutes.post('/qz/sign', requireRole('admin', 'envios', 'entrega', 'contable'), validateBody(qzSignSchema), async (req, res) => {
  const privateKeyPem = process.env.QZ_PRIVATE_KEY;
  if (!privateKeyPem) {
    return sendError(res, 503, 'NO_PRIVATE_KEY', 'Clave privada QZ no configurada en el servidor');
  }

  try {
    const payload = req.body.payload;
    // QZ Tray requiere firma RSA-SHA512 en base64
    const signature = crypto
      .createSign('SHA512')
      .update(payload)
      .sign(privateKeyPem.replace(/\\n/g, '\n'), 'base64');

    await writeAudit({ req, modulo: 'impresion', accion: 'qz_sign', entidad: 'qz_sign', entidadId: req.user.id });
    return sendOk(res, { signature });
  } catch (err) {
    console.error('[QZ Sign Error]', err.message);
    return sendError(res, 500, 'SIGN_ERROR', 'Error al firmar: ' + err.message);
  }
});
