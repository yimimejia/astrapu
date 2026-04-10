import jwt from 'jsonwebtoken';
import { get } from '../db/connection.js';
import { sendError } from '../lib/http.js';

const JWT_SECRET = process.env.JWT_SECRET || 'astrapu-dev-jwt-secret';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, rol: user.rol, sucursal_id: user.sucursal_id },
    JWT_SECRET,
    { expiresIn: '8h' },
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return sendError(res, 401, 'AUTH_REQUIRED', 'Token requerido');

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, username, nombre, rol, sucursal_id, activo FROM usuarios WHERE id = ?', [payload.sub]);
    if (!user || !user.activo) return sendError(res, 401, 'AUTH_INVALID_USER', 'Usuario inválido/inactivo');
    req.user = user;
    return next();
  } catch {
    return sendError(res, 401, 'AUTH_INVALID_TOKEN', 'Token inválido');
  }
}

export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'No autenticado');
    if (!allowed.includes(req.user.rol)) return sendError(res, 403, 'FORBIDDEN', 'Sin permisos');
    return next();
  };
}

export const RBAC = {
  readOnlyRoles: ['contable'],
};

export function forbidReadOnlyMutations(req, res, next) {
  if (RBAC.readOnlyRoles.includes(req.user.rol)) {
    return sendError(res, 403, 'READ_ONLY_ROLE', 'Rol contable: solo lectura estricta');
  }
  return next();
}
