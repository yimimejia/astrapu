const ROLE_CREDS = {
  admin: { username: 'admin', password: 'admin123' },
  envios: { username: 'm.perez', password: 'envios123' },
  entrega: { username: 'j.rodriguez', password: 'entrega123' },
  contable: { username: 'contable', password: 'contable123' },
};

let token = null;

function tokenKey(role) { return `astrapu_token_${role}`; }
function userKey(role) { return `astrapu_user_${role}`; }

function isTokenValid(t) {
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    return payload.exp * 1000 > Date.now() + 60_000;
  } catch { return false; }
}

function loadCachedSession(role) {
  const t = sessionStorage.getItem(tokenKey(role));
  const u = sessionStorage.getItem(userKey(role));
  if (isTokenValid(t) && u) return { token: t, user: JSON.parse(u) };
  return null;
}

function saveSession(role, t, user) {
  sessionStorage.setItem(tokenKey(role), t);
  sessionStorage.setItem(userKey(role), JSON.stringify(user));
}

function extractApiError(json, fallback = 'Error API') {
  if (!json) return fallback;
  if (typeof json.error === 'string') return json.error;
  if (json.error?.message) return json.error.message;
  return fallback;
}

export async function loginByRole(role) {
  const cached = loadCachedSession(role);
  if (cached) {
    token = cached.token;
    return cached.user;
  }

  const creds = ROLE_CREDS[role];
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(extractApiError(json, 'No se pudo autenticar'));
  token = json.data.token;
  saveSession(role, token, json.data.user);
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
