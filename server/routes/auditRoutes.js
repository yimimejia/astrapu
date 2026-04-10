import { Router } from 'express';
import { all, get } from '../db/connection.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const auditRoutes = Router();
auditRoutes.use(requireAuth);
auditRoutes.use(requireRole('admin', 'contable'));

auditRoutes.get('/', async (req, res) => {
  const {
    usuario,
    modulo,
    accion,
    entidad,
    sucursal,
    date_from,
    date_to,
    page = 1,
    page_size = 50,
  } = req.query;

  const where = [];
  const params = [];

  if (usuario) { where.push('username = ?'); params.push(usuario); }
  if (modulo) { where.push('modulo = ?'); params.push(modulo); }
  if (accion) { where.push('accion = ?'); params.push(accion); }
  if (entidad) { where.push('entidad = ?'); params.push(entidad); }
  if (sucursal) { where.push('sucursal_id = ?'); params.push(sucursal); }
  if (date_from) { where.push('fecha_hora >= ?'); params.push(date_from); }
  if (date_to) { where.push('fecha_hora <= ?'); params.push(date_to); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (Number(page) - 1) * Number(page_size);
  const totalRow = await get(`SELECT COUNT(*) as total FROM auditoria ${clause}`, params);
  const rows = await all(
    `SELECT * FROM auditoria ${clause} ORDER BY fecha_hora DESC LIMIT ? OFFSET ?`,
    [...params, Number(page_size), offset],
  );

  res.json({
    ok: true,
    data: rows,
    pagination: {
      page: Number(page),
      page_size: Number(page_size),
      total: totalRow.total,
      total_pages: Math.ceil(totalRow.total / Number(page_size)),
    },
  });
});
