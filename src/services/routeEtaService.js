import { db } from '../data/store.js';

export function recalculateRouteStats() {
  const byRoute = {};
  db.paquetes
    .filter((p) => p.enviado_at && p.recibido_at)
    .forEach((p) => {
      const key = `${p.sucursal_origen}->${p.sucursal_destino}`;
      const durationMin = (new Date(p.recibido_at) - new Date(p.enviado_at)) / 60000;
      const day = new Date(p.recibido_at).getDay();
      byRoute[key] ||= { durations: [], byDay: {} };
      byRoute[key].durations.push(durationMin);
      byRoute[key].byDay[day] ||= [];
      byRoute[key].byDay[day].push(durationMin);
    });

  db.rutas_estadisticas = Object.fromEntries(
    Object.entries(byRoute).map(([route, data]) => {
      const promedio = data.durations.reduce((a, b) => a + b, 0) / data.durations.length;
      const avgByDay = Object.fromEntries(Object.entries(data.byDay).map(([d, arr]) => [d, arr.reduce((a, b) => a + b, 0) / arr.length]));
      return [route, { muestras: data.durations.length, promedio_min: Math.round(promedio), promedio_por_dia: avgByDay, estado: data.durations.length < 7 ? 'Evaluando tiempo estimado' : 'Estimado disponible' }];
    }),
  );

  return db.rutas_estadisticas;
}
