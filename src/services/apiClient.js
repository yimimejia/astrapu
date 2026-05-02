let token = null;

const SESSION_KEY = 'astrapu_session_v2';

function isTokenValid(t) {
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    return payload.exp * 1000 > Date.now() + 60_000;
  } catch { return false; }
}

export function loadSavedSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { token: t, user } = JSON.parse(raw);
    if (isTokenValid(t) && user) {
      token = t;
      return user;
    }
  } catch { }
  return null;
}

export function saveSession(t, user) {
  token = t;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: t, user }));
}

export function clearSession() {
  token = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function extractApiError(json, fallback = 'Error API') {
  if (!json) return fallback;
  if (typeof json.error === 'string') return json.error;
  if (json.error?.message) return json.error.message;
  return fallback;
}

export async function loginWithCredentials(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(extractApiError(json, 'Credenciales inválidas'));
  saveSession(json.data.token, json.data.user);
  return json.data.user;
}

export function getToken() { return token; }

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(extractApiError(json, 'Error API'));
  return json;
}
