import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run } from '../db/connection.js';
import { requireAuth, requireRole, forbidReadOnlyMutations } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validation.js';
import { clienteCreateSchema, clienteUpdateSchema, sucursalSchema, usuarioCreateSchema, usuarioUpdateSchema, configGeneralSchema } from '../validation/schemas.js';
import { writeAudit } from '../lib/audit.js';
import { sendOk, sendError } from '../lib/http.js';
import { opsReadLimiter, opsMutationLimiter } from '../middleware/rateLimit.js';

export const adminRoutes = Router();

adminRoutes.use(requireAuth);

// ─── CLIENTES ────────────────────────────────────────────────────────────────

adminRoutes.post('/clientes', opsMutationLimiter, requireRole('admin', 'envios'), forbidReadOnlyMutations, validateBody(clienteCreateSchema), async (req, res) => {
  const { telefono, nombre, cedula, direccion } = req.body;
  const normalized = telefono.replace(/\D/g, '');
  const existing = await get('SELECT id FROM clientes WHERE telefono = ?', [normalized]);
  if (existing) return sendError(res, 409, 'DUPLICATE', 'Ya existe un cliente con ese teléfono');
  const id = `c-${crypto.randomUUID()}`;
  await run('INSERT INTO clientes(id, telefono, cedula, nombre, direccion) VALUES(?,?,?,?,?)', [id, normalized, cedula || null, nombre, direccion || null]);
  const created = await get('SELECT * FROM clientes WHERE id = ?', [id]);
  await writeAudit({ req, modulo: 'clientes', accion: 'creacion_cliente', entidad: 'clientes', entidadId: id, valorNuevo: { telefono: normalized, nombre } });
  return sendOk(res, created);
});

adminRoutes.put('/clientes/:id', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, validateBody(clienteUpdateSchema), async (req, res) => {
  const { id } = req.params;
  const existing = await get('SELECT * FROM clientes WHERE id = ?', [id]);
  if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Cliente no encontrado');
  const { telefono, nombre, cedula, direccion } = req.body;
  const normalized = telefono ? telefono.replace(/\D/g, '') : existing.telefono;
  await run('UPDATE clientes SET telefono=?, nombre=?, cedula=?, direccion=? WHERE id=?', [normalized, nombre || existing.nombre, cedula !== undefined ? cedula : existing.cedula, direccion !== undefined ? direccion : existing.direccion, id]);
  const updated = await get('SELECT * FROM clientes WHERE id = ?', [id]);
  await writeAudit({ req, modulo: 'clientes', accion: 'edicion_cliente', entidad: 'clientes', entidadId: id, valorAnterior: existing, valorNuevo: updated });
  return sendOk(res, updated);
});

// ─── SUCURSALES ───────────────────────────────────────────────────────────────

adminRoutes.post('/sucursales', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, validateBody(sucursalSchema), async (req, res) => {
  const { nombre, provincia } = req.body;
  const id = `suc-${crypto.randomUUID().slice(0, 8)}`;
  await run('INSERT INTO sucursales(id, nombre, provincia) VALUES(?,?,?)', [id, nombre, provincia]);
  const created = await get('SELECT * FROM sucursales WHERE id = ?', [id]);
  await writeAudit({ req, modulo: 'sucursales', accion: 'creacion_sucursal', entidad: 'sucursales', entidadId: id, valorNuevo: { nombre, provincia } });
  return sendOk(res, created);
});

adminRoutes.put('/sucursales/:id', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, validateBody(sucursalSchema), async (req, res) => {
  const { id } = req.params;
  const existing = await get('SELECT * FROM sucursales WHERE id = ?', [id]);
  if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Sucursal no encontrada');
  const { nombre, provincia } = req.body;
  await run('UPDATE sucursales SET nombre=?, provincia=? WHERE id=?', [nombre, provincia, id]);
  const updated = await get('SELECT * FROM sucursales WHERE id = ?', [id]);
  await writeAudit({ req, modulo: 'sucursales', accion: 'edicion_sucursal', entidad: 'sucursales', entidadId: id, valorAnterior: existing, valorNuevo: updated });
  return sendOk(res, updated);
});

// ─── USUARIOS ─────────────────────────────────────────────────────────────────

adminRoutes.get('/usuarios', opsReadLimiter, requireRole('admin'), async (_req, res) => {
  const rows = await all('SELECT id, username, nombre, rol, sucursal_id, activo, created_at FROM usuarios ORDER BY rol, nombre ASC');
  return sendOk(res, rows);
});

adminRoutes.post('/usuarios', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, validateBody(usuarioCreateSchema), async (req, res) => {
  const { username, nombre, password, rol, sucursal_id } = req.body;
  const existing = await get('SELECT id FROM usuarios WHERE username = ?', [username]);
  if (existing) return sendError(res, 409, 'DUPLICATE', 'Ya existe un usuario con ese username');
  const suc = await get('SELECT id FROM sucursales WHERE id = ?', [sucursal_id]);
  if (!suc) return sendError(res, 400, 'INVALID_SUCURSAL', 'Sucursal no válida');

  const salt = process.env.PASSWORD_SALT || 'astrapu-dev-salt';
  const { createHash } = await import('node:crypto');
  const password_hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  const id = `u-${crypto.randomUUID().slice(0, 8)}`;
  await run('INSERT INTO usuarios(id, username, nombre, password_hash, rol, sucursal_id) VALUES(?,?,?,?,?,?)', [id, username, nombre, password_hash, rol, sucursal_id]);
  await writeAudit({ req, modulo: 'usuarios', accion: 'creacion_usuario', entidad: 'usuarios', entidadId: id, valorNuevo: { username, nombre, rol, sucursal_id } });
  return sendOk(res, { id, username, nombre, rol, sucursal_id, activo: 1 });
});

adminRoutes.put('/usuarios/:id', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, validateBody(usuarioUpdateSchema), async (req, res) => {
  const { id } = req.params;
  const existing = await get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Usuario no encontrado');

  const updates = {};
  if (req.body.nombre) updates.nombre = req.body.nombre;
  if (req.body.rol) updates.rol = req.body.rol;
  if (req.body.sucursal_id) updates.sucursal_id = req.body.sucursal_id;
  if (req.body.password) {
    const salt = process.env.PASSWORD_SALT || 'astrapu-dev-salt';
    const { createHash } = await import('node:crypto');
    updates.password_hash = createHash('sha256').update(`${salt}:${req.body.password}`).digest('hex');
  }

  if (Object.keys(updates).length) {
    const sets = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    await run(`UPDATE usuarios SET ${sets} WHERE id = ?`, [...Object.values(updates), id]);
  }

  const updated = await get('SELECT id, username, nombre, rol, sucursal_id, activo FROM usuarios WHERE id = ?', [id]);
  await writeAudit({ req, modulo: 'usuarios', accion: 'edicion_usuario', entidad: 'usuarios', entidadId: id, valorAnterior: { nombre: existing.nombre, rol: existing.rol }, valorNuevo: updates });
  return sendOk(res, updated);
});

adminRoutes.patch('/usuarios/:id/toggle', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, async (req, res) => {
  const { id } = req.params;
  const existing = await get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!existing) return sendError(res, 404, 'NOT_FOUND', 'Usuario no encontrado');
  if (existing.username === 'admin') return sendError(res, 400, 'PROTECTED', 'No se puede desactivar al administrador principal');
  const newActivo = existing.activo ? 0 : 1;
  await run('UPDATE usuarios SET activo = ? WHERE id = ?', [newActivo, id]);
  await writeAudit({ req, modulo: 'usuarios', accion: newActivo ? 'activar_usuario' : 'desactivar_usuario', entidad: 'usuarios', entidadId: id });
  return sendOk(res, { id, activo: newActivo });
});

// ─── CONFIGURACIÓN GENERAL ───────────────────────────────────────────────────

adminRoutes.get('/config', opsReadLimiter, requireRole('admin'), async (_req, res) => {
  const row = await get('SELECT * FROM configuracion_fiscal WHERE id = ?', ['cfg-fiscal-1']);
  return sendOk(res, {
    nombre_empresa: row?.nombre_comercial || '',
    rnc_empresa: row?.rnc || '',
    direccion_empresa: row?.direccion_fiscal || '',
    correo_empresa: row?.correo_fiscal || '',
    ambiente: row?.ambiente || 'PREPARACION',
    estado: row?.estado_configuracion || 'incompleta',
  });
});

adminRoutes.put('/config', opsMutationLimiter, requireRole('admin'), forbidReadOnlyMutations, validateBody(configGeneralSchema), async (req, res) => {
  const { nombre_empresa, rnc_empresa, telefono_empresa, direccion_empresa } = req.body;
  const now = new Date().toISOString();
  await run(
    `UPDATE configuracion_fiscal SET nombre_comercial=?, rnc=?, direccion_fiscal=?, updated_at=? WHERE id='cfg-fiscal-1'`,
    [nombre_empresa, rnc_empresa || '', direccion_empresa || '', now],
  );
  await writeAudit({ req, modulo: 'configuracion', accion: 'actualizar_config', entidad: 'configuracion_fiscal', entidadId: 'cfg-fiscal-1', valorNuevo: req.body });
  return sendOk(res, { saved: true, nombre_empresa, rnc_empresa, telefono_empresa, direccion_empresa });
});
