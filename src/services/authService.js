import { MENUS } from '../constants.js';
import { loginWithCredentials, loadSavedSession, clearSession } from './apiClient.js';

let currentUser = null;

export function getStoredUser() {
  const u = loadSavedSession();
  if (u) { currentUser = u; }
  return currentUser;
}

export async function loginAs(username, password) {
  const user = await loginWithCredentials(username, password);
  currentUser = user;
  return currentUser;
}

export function logout() {
  currentUser = null;
  clearSession();
}

export function getCurrentUser() {
  return currentUser;
}

export function isLoggedIn() {
  return currentUser !== null;
}

export function getRoleMenu() {
  return MENUS[currentUser?.rol] || [];
}

export function canEdit() {
  return currentUser?.rol !== 'contable';
}

export function canAccessAdminOnly() {
  return currentUser?.rol === 'admin';
}
