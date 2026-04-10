const ROLE_CREDS = {
  admin: { username: 'admin', password: 'admin123' },
  envios: { username: 'm.perez', password: 'envios123' },
  entrega: { username: 'j.rodriguez', password: 'entrega123' },
  contable: { username: 'contable', password: 'contable123' },
};

let token = null;

function extractApiError(json, fallback = 'Error API') {
  if (!json) return fallback;
  if (typeof json.error === 'string') return json.error;
  if (json.error?.message) return json.error.message;
  return fallback;
}

export async function loginByRole(role) {
  const creds = ROLE_CREDS[role];
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(extractApiError(json, 'No se pudo autenticar'));
  token = json.data.token;
  localStorage.setItem('astrapu_api_token', token);
  return json.data.user;
}

export function getToken() {
  return token;
}

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
