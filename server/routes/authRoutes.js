import { Router } from 'express';
import { get, verifyPassword } from '../db/connection.js';
import { signAccessToken, requireAuth } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { sendError, sendOk } from '../lib/http.js';
import { validateBody } from '../middleware/validation.js';
import { loginSchema } from '../validation/schemas.js';
import { loginLimiter, logoutLimiter } from '../middleware/rateLimit.js';

export const authRoutes = Router();

authRoutes.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const { username, password } = req.body;
  const user = await get('SELECT * FROM usuarios WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Credenciales inválidas');
  }

  const token = signAccessToken(user);
  req.user = user;
  await writeAudit({ req, modulo: 'auth', accion: 'login', entidad: 'usuarios', entidadId: user.id });
  return sendOk(res, { token, user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol, sucursal_id: user.sucursal_id } });
});

authRoutes.post('/logout', logoutLimiter, requireAuth, async (req, res) => {
  await writeAudit({ req, modulo: 'auth', accion: 'logout', entidad: 'usuarios', entidadId: req.user.id });
  return sendOk(res, { logout: true });
});

authRoutes.get('/me', requireAuth, async (req, res) => {
  return sendOk(res, req.user);
});
