import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { get } from '../db/connection.js';
import { fiscalLimiter } from '../middleware/rateLimit.js';
import { validateBody, validateParams } from '../middleware/validation.js';
import { fiscalConfigSchema, fiscalDocumentParamsSchema, fiscalDraftSchema, fiscalTrackParamsSchema } from '../validation/schemas.js';
import { sendOk } from '../lib/http.js';

export const fiscalRoutes = Router();

fiscalRoutes.use(fiscalLimiter);
fiscalRoutes.use(requireAuth);
fiscalRoutes.use(requireRole('admin', 'contable'));

fiscalRoutes.get('/status', async (_req, res) => {
  const cfg = await get('SELECT id, rnc, razon_social, ambiente, estado_configuracion FROM configuracion_fiscal WHERE id = ?', ['cfg-fiscal-1']);
  return sendOk(res, { mode: 'PREPARACION', integracion_dgii_real: false, configuracion: cfg });
});

fiscalRoutes.get('/note', (_req, res) => {
  return sendOk(res, {
    message: 'Integración real DGII en pausa por prioridad de base técnica backend/seguridad.',
    next_step: 'Conectar FiscalController/FiscalService al repositorio SQL y colas de envío.',
  });
});

fiscalRoutes.post('/config', validateBody(fiscalConfigSchema), async (req, res) => {
  return sendOk(res, { saved: true, ...req.body, warning: 'Mock fiscal config guardado en modo preparación.' });
});

fiscalRoutes.post('/documents/draft', validateBody(fiscalDraftSchema), async (req, res) => {
  return sendOk(res, { draft_id: `draft-${req.body.venta_id}`, estado: 'BORRADOR' });
});

fiscalRoutes.post('/documents/:documentId/xml', validateParams(fiscalDocumentParamsSchema), async (req, res) => {
  return sendOk(res, { document_id: req.params.documentId, xml_generated: true });
});

fiscalRoutes.post('/documents/:documentId/sign', validateParams(fiscalDocumentParamsSchema), async (req, res) => {
  return sendOk(res, { document_id: req.params.documentId, signed: true });
});

fiscalRoutes.post('/documents/:documentId/send', validateParams(fiscalDocumentParamsSchema), async (req, res) => {
  return sendOk(res, { document_id: req.params.documentId, sent: false, mode: 'PREPARACION' });
});

fiscalRoutes.get('/tracks/:trackId', validateParams(fiscalTrackParamsSchema), async (req, res) => {
  return sendOk(res, { track_id: req.params.trackId, estado: 'PENDIENTE', mode: 'PREPARACION' });
});

fiscalRoutes.post('/documents/:documentId/retry', validateParams(fiscalDocumentParamsSchema), async (req, res) => {
  return sendOk(res, { document_id: req.params.documentId, retry_queued: true, mode: 'PREPARACION' });
});
