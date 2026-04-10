import crypto from 'node:crypto';
import { run, get, all } from '../db/connection.js';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export { DIAS };

export function getFranjaHoraria(hour) {
  if (hour < 6) return 'madrugada';
  if (hour < 12) return 'mañana';
  if (hour < 18) return 'tarde';
  return 'noche';
}

function removeOutliers(values) {
  if (values.length < 4) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return values.filter((v) => v >= lo && v <= hi);
}

function weightedAvg(samples) {
  const now = Date.now();
  const month = 30 * 86400000;
  let wSum = 0;
  let wTotal = 0;
  for (const s of samples) {
    const age = now - new Date(s.fecha_salida || s.created_at).getTime();
    const w = age < month ? 2 : 1;
    wSum += s.duracion_minutos * w;
    wTotal += w;
  }
  return wTotal > 0 ? wSum / wTotal : 0;
}

export function getWeekStr() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function registerSampleStart(paqueteId, origenId, destinoId) {
  try {
    const existing = await get('SELECT id FROM route_eta_samples WHERE paquete_id = ?', [paqueteId]);
    if (existing) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    await run(
      `INSERT OR IGNORE INTO route_eta_samples(id, sucursal_origen_id, sucursal_destino_id, paquete_id, fecha_salida, dia_semana, franja_horaria)
       VALUES(?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), origenId, destinoId, paqueteId, now.toISOString(), now.getDay(), getFranjaHoraria(now.getHours())],
    );
    const vol = await get(
      `SELECT COUNT(*) as cnt FROM route_eta_samples WHERE sucursal_origen_id=? AND sucursal_destino_id=? AND fecha_salida LIKE ?`,
      [origenId, destinoId, `${today}%`],
    );
    await run('UPDATE route_eta_samples SET volumen_ruta_dia=? WHERE paquete_id=?', [vol?.cnt || 1, paqueteId]);
  } catch (e) {
    console.error('[ETA] registerSampleStart:', e.message);
  }
}

export async function registerSampleEnd(paqueteId) {
  try {
    const sample = await get('SELECT * FROM route_eta_samples WHERE paquete_id=?', [paqueteId]);
    if (!sample || sample.fecha_llegada) return;
    const now = new Date();
    const duracion = Math.round((now - new Date(sample.fecha_salida)) / 60000);
    if (duracion < 1 || duracion > 72 * 60) return;
    await run(
      'UPDATE route_eta_samples SET fecha_llegada=?, duracion_minutos=? WHERE paquete_id=?',
      [now.toISOString(), duracion, paqueteId],
    );
    await updateRouteStats(sample.sucursal_origen_id, sample.sucursal_destino_id);
  } catch (e) {
    console.error('[ETA] registerSampleEnd:', e.message);
  }
}

export async function updateRouteStats(origenId, destinoId) {
  try {
    const completados = await all(
      `SELECT * FROM route_eta_samples WHERE sucursal_origen_id=? AND sucursal_destino_id=? AND duracion_minutos IS NOT NULL`,
      [origenId, destinoId],
    );
    if (completados.length === 0) return;

    const valores = completados.map((s) => s.duracion_minutos);
    const filtrados = removeOutliers(valores);
    const samplesFiltrados = completados.filter((s) => filtrados.includes(s.duracion_minutos));

    const promedioGeneral = weightedAvg(samplesFiltrados);

    const porDia = {};
    for (let d = 0; d < 7; d++) {
      const ds = samplesFiltrados.filter((s) => s.dia_semana === d);
      if (ds.length > 0) porDia[d] = ds.reduce((a, b) => a + b.duracion_minutos, 0) / ds.length;
    }

    const porFranja = {};
    for (const f of ['madrugada', 'mañana', 'tarde', 'noche']) {
      const fs = samplesFiltrados.filter((s) => s.franja_horaria === f);
      if (fs.length > 0) porFranja[f] = fs.reduce((a, b) => a + b.duracion_minutos, 0) / fs.length;
    }

    const diasUnicos = new Set(completados.map((s) => (s.fecha_salida || '').slice(0, 10))).size;
    const n = samplesFiltrados.length;
    const varianza =
      n > 1 ? samplesFiltrados.reduce((acc, s) => acc + Math.pow(s.duracion_minutos - promedioGeneral, 2), 0) / (n - 1) : 0;
    const cv = promedioGeneral > 0 ? Math.sqrt(varianza) / promedioGeneral : 1;

    let estadoModelo = 'aprendiendo';
    let confianza = 0;
    if (diasUnicos >= 7) {
      if (n >= 30 && cv < 0.3) { estadoModelo = 'confianza_alta'; confianza = 0.9; }
      else if (n >= 15 && cv < 0.5) { estadoModelo = 'confianza_media'; confianza = 0.65; }
      else { estadoModelo = 'confianza_baja'; confianza = 0.4; }
    }

    const fechaPrimera = completados.reduce((m, s) => (s.fecha_salida < m ? s.fecha_salida : m), completados[0].fecha_salida);
    const existing = await get('SELECT id FROM route_eta_stats WHERE sucursal_origen_id=? AND sucursal_destino_id=?', [origenId, destinoId]);

    if (existing) {
      await run(
        `UPDATE route_eta_stats SET muestras_totales=?,muestras_dias_unicos=?,promedio_general_minutos=?,promedio_por_dia_json=?,promedio_por_franja_json=?,fecha_primera_muestra=?,fecha_ultima_actualizacion=?,estado_modelo=?,confianza=? WHERE sucursal_origen_id=? AND sucursal_destino_id=?`,
        [n, diasUnicos, promedioGeneral, JSON.stringify(porDia), JSON.stringify(porFranja), fechaPrimera, new Date().toISOString(), estadoModelo, confianza, origenId, destinoId],
      );
    } else {
      await run(
        `INSERT INTO route_eta_stats(id,sucursal_origen_id,sucursal_destino_id,muestras_totales,muestras_dias_unicos,promedio_general_minutos,promedio_por_dia_json,promedio_por_franja_json,fecha_primera_muestra,fecha_ultima_actualizacion,estado_modelo,confianza) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [crypto.randomUUID(), origenId, destinoId, n, diasUnicos, promedioGeneral, JSON.stringify(porDia), JSON.stringify(porFranja), fechaPrimera, new Date().toISOString(), estadoModelo, confianza],
      );
    }
  } catch (e) {
    console.error('[ETA] updateRouteStats:', e.message);
  }
}

export async function getRouteEta(origenId, destinoId) {
  try {
    const stats = await get('SELECT * FROM route_eta_stats WHERE sucursal_origen_id=? AND sucursal_destino_id=?', [origenId, destinoId]);
    if (!stats) return { estado: 'sin_datos' };

    if (stats.estado_modelo === 'aprendiendo') {
      return {
        estado: 'aprendiendo',
        muestras: stats.muestras_totales,
        dias_unicos: stats.muestras_dias_unicos,
        dias_faltantes: Math.max(0, 7 - stats.muestras_dias_unicos),
      };
    }

    const now = new Date();
    const porDia = JSON.parse(stats.promedio_por_dia_json || '{}');
    const porFranja = JSON.parse(stats.promedio_por_franja_json || '{}');
    const franja = getFranjaHoraria(now.getHours());
    const dia = now.getDay();

    let eta = stats.promedio_general_minutos * 0.4;
    eta += (porDia[dia] !== undefined ? porDia[dia] : stats.promedio_general_minutos) * 0.35;
    eta += (porFranja[franja] !== undefined ? porFranja[franja] : stats.promedio_general_minutos) * 0.25;

    const horas = Math.floor(eta / 60);
    const mins = Math.round(eta % 60);
    const llegada = new Date(now.getTime() + eta * 60000);

    return {
      estado: stats.estado_modelo,
      eta_minutos: Math.round(eta),
      eta_str: horas > 0 ? `${horas}h ${mins}m` : `${mins} min`,
      llegada_estimada: llegada.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }),
      confianza: stats.confianza,
      muestras: stats.muestras_totales,
    };
  } catch (e) {
    return { estado: 'error' };
  }
}

export async function getEfficiencyReport() {
  try {
    const stats = await all('SELECT * FROM route_eta_stats ORDER BY muestras_totales DESC');
    return stats.map((s) => ({
      ...s,
      promedio_por_dia: JSON.parse(s.promedio_por_dia_json || '{}'),
      promedio_por_franja: JSON.parse(s.promedio_por_franja_json || '{}'),
    }));
  } catch (e) {
    return [];
  }
}

export async function getPendingRecommendations() {
  return all("SELECT * FROM route_eta_recommendations WHERE estado='pendiente' ORDER BY created_at DESC");
}

export async function acceptRecommendation(id) {
  await run("UPDATE route_eta_recommendations SET estado='aceptada', aceptada_at=? WHERE id=?", [new Date().toISOString(), id]);
}

export async function countWeekRecs() {
  const row = await get("SELECT COUNT(*) as cnt FROM route_eta_recommendations WHERE semana=?", [getWeekStr()]);
  return row?.cnt || 0;
}
