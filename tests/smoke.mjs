import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'astrapu-smoke-'));
process.env.ASTRAPU_DB_PATH = path.join(tempDir, 'astrapu.sqlite');
process.env.JWT_SECRET = 'smoke-secret';

const { migrate, db } = await import('../server/db/connection.js');
const { buildApp } = await import('../server/app.js');

await migrate();

const app = buildApp();
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const CREDS = {
  admin: { username: 'admin', password: 'admin123' },
  envios: { username: 'm.perez', password: 'envios123' },
  contable: { username: 'contable', password: 'contable123' },
};

async function request(method, pathname, body, token) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => null);
  return { res, json };
}

async function login(role) {
  const { res, json } = await request('POST', '/api/auth/login', CREDS[role]);
  assert.equal(res.status, 200, `login ${role} debe responder 200`);
  return json.data.token;
}

try {
  const adminToken = await login('admin');
  const enviosToken = await login('envios');
  const contableToken = await login('contable');

  // 403 rol contable sobre endpoint mutante
  const contableEnvio = await request('POST', '/api/ops/envios', {
    telefono: '8095551000', nombre: 'Contable', descripcion: 'Caja', color_empaque: 'Rojo', monto: 10, sucursal_origen: 'suc-1', sucursal_destino: 'suc-2',
  }, contableToken);
  assert.equal(contableEnvio.res.status, 403);
  assert.equal(contableEnvio.json.error.code, 'READ_ONLY_ROLE');

  // payload inválido impresión/config
  const invalidPrintCfg = await request('PUT', '/api/impresion/config', {
    impresora_termica: 'EPSON-1',
    impresora_adhesiva: 123,
  }, adminToken);
  assert.equal(invalidPrintCfg.res.status, 400);
  assert.equal(invalidPrintCfg.json.error.code, 'VALIDATION_ERROR');

  // payload inválido fiscal
  const invalidFiscal = await request('POST', '/api/fiscal/config', {
    rnc: '',
    razon_social: '',
  }, adminToken);
  assert.equal(invalidFiscal.res.status, 400);
  assert.equal(invalidFiscal.json.error.code, 'VALIDATION_ERROR');

  // payload válido registrar envío
  const validEnvio = await request('POST', '/api/ops/envios', {
    telefono: '809-555-1001',
    nombre: 'Cliente Smoke',
    cedula: '00112345678',
    direccion: 'Zona Colonial',
    descripcion: 'Caja pequeña',
    color_empaque: 'Azul',
    monto: 150,
    sucursal_origen: 'suc-1',
    sucursal_destino: 'suc-2',
    metodo_pago: 'EFECTIVO',
  }, enviosToken);
  assert.equal(validEnvio.res.status, 200);
  assert.equal(validEnvio.json.ok, true);
  const guia = validEnvio.json.data.guia;

  // escaneo válido send + receive
  const scanSendOk = await request('POST', '/api/ops/paquetes/scan-send', { code: guia }, enviosToken);
  assert.equal(scanSendOk.res.status, 200);
  const scanReceiveOk = await request('POST', '/api/ops/paquetes/scan-receive', { code: guia }, enviosToken);
  assert.equal(scanReceiveOk.res.status, 200);

  // escaneo inválido (estado no permitido)
  const scanReceiveInvalid = await request('POST', '/api/ops/paquetes/scan-receive', { code: guia }, enviosToken);
  assert.equal(scanReceiveInvalid.res.status, 400);

  // escaneo operativo normal no cae en 429 fácil (ráfaga de 80)
  let throttled = 0;
  for (let i = 0; i < 80; i += 1) {
    const burst = await request('POST', '/api/ops/paquetes/scan-receive', { code: guia }, enviosToken);
    if (burst.res.status === 429) throttled += 1;
  }
  assert.equal(throttled, 0, 'escaneo normal no debería caer en 429 con 80 req/min');

  // cierre válido (requiere ventas pendientes de envios)
  const closeCash = await request('POST', '/api/ops/ventas/close', { monto_contado: 150, observacion: 'cierre smoke' }, enviosToken);
  assert.equal(closeCash.res.status, 200);
  assert.equal(closeCash.json.ok, true);

  // rate limit login (debe responder 429 tras múltiples intentos)
  let got429 = false;
  for (let i = 0; i < 10; i += 1) {
    const badLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'incorrecta-xyz' });
    if (badLogin.res.status === 429) {
      got429 = true;
      break;
    }
  }
  assert.equal(got429, true, 'login debe responder 429 bajo ráfaga fallida');

  console.log('Smoke tests OK');
} finally {
  server.close();
  await new Promise((resolve) => db.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
}
