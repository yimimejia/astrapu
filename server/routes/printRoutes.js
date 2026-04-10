import { Router } from 'express';
import crypto from 'node:crypto';
import { get, run } from '../db/connection.js';
import { requireAuth, forbidReadOnlyMutations } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { validateBody } from '../middleware/validation.js';
import { printerConfigSchema, qzSignSchema } from '../validation/schemas.js';
import { printLimiter } from '../middleware/rateLimit.js';
import { sendOk, sendError } from '../lib/http.js';

export const printRoutes = Router();

printRoutes.use(printLimiter);

// ─── CERTIFICADO X.509 QZ TRAY ───────────────────────────────────────────────
// QZ Tray necesita un certificado X.509 autofirmado (BEGIN CERTIFICATE).
// Este endpoint lo devuelve para que el frontend lo pase a setCertificatePromise.
// No requiere auth porque QZ Tray lo llama antes de establecer sesión.
// Almacenado en QZ_CERTIFICATE (variable de entorno del servidor).
printRoutes.get('/qz/cert', (_req, res) => {
  const cert = process.env.QZ_CERTIFICATE;
  if (!cert) {
    return res.status(503).type('text/plain').send('');
  }
  res.type('text/plain').send(cert.replace(/\\n/g, '\n'));
});

// ─── DESCARGA DEL CERTIFICADO PARA QZ TRAY ────────────────────────────────────
// El usuario descarga este archivo .crt una sola vez y lo agrega en
// QZ Tray → Site Manager → Add. Después QZ Tray no vuelve a pedir permiso.
printRoutes.get('/qz/cert/download', (_req, res) => {
  const cert = process.env.QZ_CERTIFICATE;
  if (!cert) {
    return sendError(res, 503, 'NO_CERT', 'Certificado no configurado');
  }
  res.setHeader('Content-Disposition', 'attachment; filename="astrapu-qztray.crt"');
  res.type('text/plain').send(cert.replace(/\\n/g, '\n'));
});

// ─── FIRMA RSA-SHA512 PARA QZ TRAY ────────────────────────────────────────────
// Este endpoint NO requiere autenticación de usuario porque QZ Tray lo llama
// durante el protocolo de conexión (setSignaturePromise), antes de que exista
// sesión de usuario. Es confianza a nivel de APP, protegida por la clave privada
// del servidor (QZ_PRIVATE_KEY). El rate limiter previene abuso.
printRoutes.post('/qz/sign', validateBody(qzSignSchema), async (req, res) => {
  const privateKeyPem = process.env.QZ_PRIVATE_KEY;
  if (!privateKeyPem) {
    return sendError(res, 503, 'NO_PRIVATE_KEY', 'Clave privada QZ no configurada en el servidor');
  }
  try {
    const payload = req.body.payload;
    const signature = crypto
      .createSign('SHA512')
      .update(payload)
      .sign(privateKeyPem, 'base64');
    return sendOk(res, { signature });
  } catch (err) {
    console.error('[QZ Sign Error]', err.message);
    return sendError(res, 500, 'SIGN_ERROR', 'Error al firmar: ' + err.message);
  }
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
