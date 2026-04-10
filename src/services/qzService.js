import { db, persistPrinterConfigLocal, loadPrinterConfigLocal } from '../data/store.js';
import { logAudit } from './auditService.js';
import { getToken } from './apiClient.js';

loadPrinterConfigLocal();

const state = {
  connected: false,
  printers: [],
  signingMode: 'BACKEND_SIGNING',
};

function getAuthToken() {
  return getToken() || localStorage.getItem('astrapu_api_token') || '';
}

export async function connectQZ() {
  if (!window.qz?.websocket) {
    return { ok: false, error: 'La librería QZ Tray no está cargada en el navegador. Verifique la conexión a internet.' };
  }

  try {
    if (window.qz.security) {
      window.qz.security.setCertificatePromise((_resolve, reject) => {
        reject('QZ Tray usando firma HMAC por backend');
      });

      window.qz.security.setSignaturePromise(async (toSign) => {
        const token = getAuthToken();
        const res = await fetch('/api/impresion/qz/sign', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ payload: toSign }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || json.error || 'No se pudo firmar mensaje QZ');
        return json.data?.signature || json.signature;
      });
    }

    if (!window.qz.websocket.isActive()) {
      const isHttps = location.protocol === 'https:';
      await window.qz.websocket.connect({
        host: ['localhost'],
        port: { secure: [8183, 8181], insecure: [8182, 8080] },
        usingSecure: isHttps,
        keepAlive: 60,
        retries: 1,
        delay: 0,
      });
    }

    state.connected = window.qz.websocket.isActive();
    if (state.connected) {
      state.printers = await window.qz.printers.find();
      logAudit({ modulo: 'impresion', accion: 'qz_connect', entidad: 'qz', entidad_id: 'qz', observacion: 'Conectado correctamente' });
    }
    return { ok: state.connected, printers: state.printers };
  } catch (error) {
    state.connected = false;
    const msg = String(error);
    const isCertError = msg.includes('ERR_CERT') || msg.includes('SSL') || msg.includes('Unable to establish') || msg.includes('net::');
    logAudit({ modulo: 'impresion', accion: 'qz_connect_error', entidad: 'qz', entidad_id: 'qz', resultado: 'ERROR', observacion: msg });
    return {
      ok: false,
      error: isCertError
        ? 'CERT_ERROR'
        : msg,
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
