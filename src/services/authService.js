import { MENUS } from '../constants.js';
import { loginWithCredentials, loadSavedSession, clearSession } from './apiClient.js';

let currentUser = null;
let simulatedRole = null;

const SUPER_ADMIN_USERS = ['Yimi'];

export function getStoredUser() {
  const u = loadSavedSession();
  if (u) { currentUser = u; }
  return getCurrentUser();
}

export async function loginAs(username, password) {
  const user = await loginWithCredentials(username, password);
  currentUser = user;
  simulatedRole = null;
  return getCurrentUser();
}

export function logout() {
  currentUser = null;
  simulatedRole = null;
  clearSession();
}

export function getCurrentUser() {
  if (!currentUser) return null;
  if (simulatedRole && simulatedRole !== currentUser.rol) {
    return { ...currentUser, rol: simulatedRole, _realRol: currentUser.rol };
  }
  return currentUser;
}

export function isLoggedIn() {
  return currentUser !== null;
}

export function isSuperAdmin() {
  if (!currentUser) return false;
  return SUPER_ADMIN_USERS.includes(currentUser.username) && currentUser.rol === 'admin';
}

export function setSimulatedRole(rol) {
  if (!isSuperAdmin()) return;
  simulatedRole = rol || null;
}

export function getSimulatedRole() {
  return simulatedRole;
}

export function getRoleMenu() {
  const user = getCurrentUser();
  return MENUS[user?.rol] || [];
}

export function canEdit() {
  return getCurrentUser()?.rol !== 'contable';
}

export function canAccessAdminOnly() {
  return getCurrentUser()?.rol === 'admin';
}
