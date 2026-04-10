// ─── QZ TRAY SERVICE ──────────────────────────────────────────────────────────
// Gestiona la conexión con QZ Tray para impresión térmica (ESC/POS) y adhesiva (ZPL).
//
// FLUJO DE SEGURIDAD:
//   1. setCertificatePromise  → el frontend pide el certificado público al backend
//                               (GET /api/impresion/qz/cert). Siempre el mismo.
//   2. setSignaturePromise    → QZ Tray pide una firma RSA-SHA512 de un payload.
//                               El frontend llama al backend (POST /api/impresion/qz/sign),
//                               que firma con la clave privada (QZ_PRIVATE_KEY, server-only).
//   3. qz.websocket.connect() → si el certificado ya fue agregado en el Site Manager
//                               de QZ Tray, conecta sin ningún diálogo de permisos.

import { db, persistPrinterConfigLocal, loadPrinterConfigLocal } from '../data/store.js';
import { logAudit } from './auditService.js';

loadPrinterConfigLocal();

const state = {
  connected: false,
  printers: [],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Obtiene el certificado X.509 desde el backend (siempre el mismo, no se regenera)
async function fetchCertificate() {
  const res = await fetch('/api/impresion/qz/cert');
  if (!res.ok) throw new Error('No se pudo obtener el certificado QZ del servidor');
  return res.text();
}

// Firma un payload con la clave privada del servidor (RSA-SHA512).
// No requiere token de usuario: es autenticación a nivel de APP.
async function signPayload(toSign) {
  const res = await fetch('/api/impresion/qz/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: toSign }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error?.message || json.error || 'Error de firma');
  return json.data?.signature || json.signature;
}

// ─── CONEXIÓN ─────────────────────────────────────────────────────────────────

export async function connectQZ() {
  if (typeof window === 'undefined' || !window.qz) {
    return { ok: false, error: 'QZ_LIB_NOT_LOADED' };
  }

  const qz = window.qz;

  try {
    // Configurar certificado y firma ANTES de conectar.
    // setCertificatePromise: QZ Tray llama esto para verificar la identidad de la app.
    // setSignatureAlgorithm: debe coincidir con el algoritmo usado en el backend (SHA512).
    //                        Si no se declara, QZ Tray usa SHA1 por defecto y la verificación falla.
    // setSignaturePromise:   QZ Tray llama esto para verificar cada solicitud.
    qz.security.setCertificatePromise((resolve, reject) => {
      fetchCertificate().then(resolve).catch(reject);
    });

    qz.security.setSignatureAlgorithm('SHA512');

    qz.security.setSignaturePromise((toSign) => {
      return signPayload(toSign);
    });

    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({
        host: ['localhost'],
        port: { secure: [8183, 8181], insecure: [8182, 8080] },
        usingSecure: location.protocol === 'https:',
        keepAlive: 60,
        retries: 1,
        delay: 0,
      });
    }

    state.connected = qz.websocket.isActive();
    if (state.connected) {
      state.printers = await qz.printers.find();
      logAudit({ modulo: 'impresion', accion: 'qz_connect', entidad: 'qz', entidad_id: 'qz', observacion: 'Conectado con certificado RSA' });
    }
    return { ok: state.connected, printers: state.printers };
  } catch (error) {
    state.connected = false;
    const msg = String(error);
    const isNotRunning = msg.includes('Unable to establish') || msg.includes('Connection refused') || msg.includes('ECONNREFUSED') || msg.includes('closed before') || msg.includes('WebSocket');
    const isCertError = msg.includes('ERR_CERT') || msg.includes('SSL') || msg.includes('net::');
    logAudit({ modulo: 'impresion', accion: 'qz_connect_error', entidad: 'qz', entidad_id: 'qz', resultado: 'ERROR', observacion: msg });
    return {
      ok: false,
      error: isCertError ? 'CERT_ERROR' : isNotRunning ? 'QZ_NOT_RUNNING' : msg,
    };
  }
}

export async function disconnectQZ() {
  if (window.qz?.websocket?.isActive()) {
    await window.qz.websocket.disconnect();
  }
  state.connected = false;
  return { ok: true };
}

export async function getPrinters() {
  if (!state.connected) return [];
  return state.printers;
}

export function setPrinterConfig(termica, adhesiva) {
  db.configuracion_impresoras.termica = termica;
  db.configuracion_impresoras.adhesiva = adhesiva;
  persistPrinterConfigLocal();
  logAudit({ modulo: 'impresion', accion: 'configuracion_impresoras', entidad: 'configuracion_impresoras', entidad_id: 'global', valor_nuevo: db.configuracion_impresoras });
}

export function getPrinterConfig() {
  return db.configuracion_impresoras;
}

// ─── PLANTILLAS DE IMPRESIÓN ──────────────────────────────────────────────────

function escposTicket(data) {
  const line = (txt) => txt.padEnd(32).slice(0, 32);
  return [
    '\x1B\x40',
    '\x1B\x61\x01',
    '\x1B\x21\x30',
    'ASTRAPU\n',
    '\x1B\x21\x00',
    'Paqueteria Interprovincial RD\n',
    '--------------------------------\n',
    `GUIA: ${data.guia}\n`,
    `CLIENTE: ${data.cliente}\n`,
    `MONTO: RD$ ${data.monto}\n`,
    '--------------------------------\n',
    'Gracias por preferirnos\n\n\n',
    '\x1D\x56\x41',
  ].join('');
}

function zplLabel(data) {
  return [
    '^XA',
    '^CF0,40',
    `^FO40,30^FDASTRAPU^FS`,
    `^CF0,28`,
    `^FO40,90^FDGUIA: ${data.guia}^FS`,
    `^FO40,130^FDDESTINO: ${data.destino}^FS`,
    `^FO40,180^BY2^BCN,80,Y,N,N^FD${data.codigo_barras || data.guia}^FS`,
    '^XZ',
  ].join('\n');
}

async function rawPrint(printerName, payload) {
  if (!state.connected || !window.qz) return { ok: false, error: 'QZ no conectado' };
  try {
    const config = window.qz.configs.create(printerName);
    await window.qz.print(config, [{ type: 'raw', format: 'plain', data: payload }]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function printThermalTicket(data) {
  const printer = db.configuracion_impresoras.termica;
  if (!printer) return { ok: false, error: 'Impresora térmica no configurada.' };
  const result = await rawPrint(printer, escposTicket(data));
  logAudit({ modulo: 'impresion', accion: 'impresion_ticket', entidad: 'historial_impresion', entidad_id: data.guia, resultado: result.ok ? 'OK' : 'ERROR', observacion: result.error || '' });
  return result;
}

export async function printAdhesiveLabel(data) {
  const printer = db.configuracion_impresoras.adhesiva;
  if (!printer) return { ok: false, error: 'Impresora adhesiva no configurada.' };
  const result = await rawPrint(printer, zplLabel(data));
  logAudit({ modulo: 'impresion', accion: 'impresion_etiqueta', entidad: 'historial_impresion', entidad_id: data.guia, resultado: result.ok ? 'OK' : 'ERROR', observacion: result.error || '' });
  return result;
}

export function qzState() {
  return state;
}
