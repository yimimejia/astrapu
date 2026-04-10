import { MENUS } from '../constants.js';
import { loginByRole } from './apiClient.js';

let currentUser = {
  id: 'u-admin',
  username: 'admin',
  nombre: 'Administrador General',
  rol: 'admin',
  sucursal_id: 'suc-1',
};

export async function loginAs(role) {
  const user = await loginByRole(role);
  currentUser = user;
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export function getRoleMenu() {
  return MENUS[currentUser.rol];
}

export function canEdit() {
  return currentUser.rol !== 'contable';
}

export function canAccessAdminOnly() {
  return currentUser.rol === 'admin';
}
