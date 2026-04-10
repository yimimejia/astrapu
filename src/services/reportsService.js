import { db } from '../data/store.js';
import { recalculateRouteStats } from './routeEtaService.js';

function groupCount(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return Array.from(map.entries()).map(([key, count]) => ({ key, count }));
}

export function buildReports() {
  const bySucursal = db.sucursales.map((s) => ({ sucursal: s.nombre, paquetes: db.paquetes.filter((p) => p.sucursal_origen === s.id).length }));
  const byEstado = groupCount(db.paquetes, (p) => p.estado).map((x) => ({ estado: x.key, cantidad: x.count }));
  const ingresos = db.sucursales.map((s) => ({ sucursal: s.nombre, ingresos: db.ventas.filter((v) => v.sucursal_id === s.id).reduce((a, b) => a + b.monto, 0) }));
  const cierresUsuario = db.usuarios.map((u) => ({ usuario: u.username, cierres: db.cierres_caja.filter((c) => c.usuario_id === u.id).length }));
  const frecuentes = db.clientes
    .map((c) => ({ cliente: c.nombre, envios: db.paquetes.filter((p) => p.cliente_id === c.id).length }))
    .sort((a, b) => b.envios - a.envios)
    .slice(0, 5);

  return {
    bySucursal,
    byEstado,
    entregadosPorFecha: groupCount(db.paquetes.filter((p) => p.entregado_at), (p) => p.entregado_at.slice(0, 10)).map((x) => ({ fecha: x.key, cantidad: x.count })),
    ingresos,
    cierresUsuario,
    tiemposRuta: Object.entries(recalculateRouteStats()).map(([ruta, v]) => ({ ruta, ...v })),
    frecuentes,
  };
}
