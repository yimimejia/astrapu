import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { sendOk, sendError } from '../lib/http.js';
import { all } from '../db/connection.js';
import {
  getRouteEta,
  getEfficiencyReport,
  getPendingRecommendations,
  acceptRecommendation,
  updateRouteStats,
  DIAS,
} from '../services/routeEtaService.js';
import { generateWeeklyRecommendations } from '../services/etaGeminiService.js';

export const etaRoutes = Router();
etaRoutes.use(requireAuth);

etaRoutes.get('/route/:origen/:destino', async (req, res) => {
  try {
    const eta = await getRouteEta(req.params.origen, req.params.destino);
    return sendOk(res, eta);
  } catch (e) {
    return sendError(res, 500, 'ETA_ERROR', e.message);
  }
});

etaRoutes.get('/efficiency', async (req, res) => {
  try {
    const stats = await getEfficiencyReport();
    const sucursales = await all('SELECT id, nombre FROM sucursales');
    const map = Object.fromEntries(sucursales.map((s) => [s.id, s.nombre]));
    const enriched = stats.map((s) => ({
      ...s,
      origen_nombre: map[s.sucursal_origen_id] || s.sucursal_origen_id,
      destino_nombre: map[s.sucursal_destino_id] || s.sucursal_destino_id,
      dias_labels: DIAS,
    }));
    return sendOk(res, enriched);
  } catch (e) {
    return sendError(res, 500, 'ETA_ERROR', e.message);
  }
});

etaRoutes.get('/recommendations', async (req, res) => {
  try {
    const recs = await getPendingRecommendations();
    return sendOk(res, recs);
  } catch (e) {
    return sendError(res, 500, 'ETA_ERROR', e.message);
  }
});

etaRoutes.post('/recommendations/:id/accept', async (req, res) => {
  try {
    await acceptRecommendation(req.params.id);
    return sendOk(res, { ok: true });
  } catch (e) {
    return sendError(res, 500, 'ETA_ERROR', e.message);
  }
});

etaRoutes.post('/recommendations/generate', async (req, res) => {
  try {
    const sucursales = await all('SELECT id, nombre FROM sucursales');
    const map = Object.fromEntries(sucursales.map((s) => [s.id, s.nombre]));
    const result = await generateWeeklyRecommendations(map);
    return sendOk(res, result);
  } catch (e) {
    return sendError(res, 500, 'ETA_ERROR', e.message);
  }
});

etaRoutes.post('/recalculate', async (req, res) => {
  try {
    const rutas = await all(
      `SELECT DISTINCT sucursal_origen_id, sucursal_destino_id FROM route_eta_samples WHERE duracion_minutos IS NOT NULL`,
    );
    for (const r of rutas) {
      await updateRouteStats(r.sucursal_origen_id, r.sucursal_destino_id);
    }
    return sendOk(res, { recalculated: rutas.length });
  } catch (e) {
    return sendError(res, 500, 'ETA_ERROR', e.message);
  }
});
