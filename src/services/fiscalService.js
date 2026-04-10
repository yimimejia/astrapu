/**
 * Cliente frontend del módulo fiscal backend.
 * No maneja certificados, llaves ni firma en frontend.
 */

const API_BASE = '/api/fiscal';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.error === 'string'
      ? body.error
      : body?.error?.message || `Error fiscal API (${response.status})`;
    throw new Error(message);
  }
  return body;
}

export async function validateFiscalConfiguration() {
  return request('/config/validate');
}

export async function configureFiscalEmitter(payload) {
  return request('/config', { method: 'POST', body: JSON.stringify(payload) });
}

export async function createFiscalDraftFromSale(payload) {
  return request('/documents/draft', { method: 'POST', body: JSON.stringify(payload) });
}

export async function generateFiscalXml(documentId) {
  return request(`/documents/${documentId}/xml`, { method: 'POST' });
}

export async function signFiscalDocument(documentId) {
  return request(`/documents/${documentId}/sign`, { method: 'POST' });
}

export async function sendFiscalDocument(documentId) {
  return request(`/documents/${documentId}/send`, { method: 'POST' });
}

export async function getFiscalTrackStatus(trackId) {
  return request(`/tracks/${trackId}`, { method: 'GET' });
}

export async function retryFiscalDocument(documentId) {
  return request(`/documents/${documentId}/retry`, { method: 'POST' });
}
