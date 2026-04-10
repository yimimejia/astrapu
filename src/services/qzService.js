import { db, persistPrinterConfigLocal, loadPrinterConfigLocal } from '../data/store.js';
import { logAudit } from './auditService.js';

loadPrinterConfigLocal();

const state = {
  connected: false,
  printers: [],
  signingMode: 'BACKEND_SIGNING',
};

export async function connectQZ() {
  if (window.qz?.websocket) {
    try {
      if (window.qz.security) {
        window.qz.security.setSignaturePromise(async (toSign) => {
          const token = localStorage.getItem('astrapu_api_token');
          const res = await fetch('/api/impresion/qz/sign', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ payload: toSign }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'No se pudo firmar mensaje QZ');
          return json.signature;
        });
      }

      if (!window.qz.websocket.isActive()) {
        await window.qz.websocket.connect();
      }
      state.connected = window.qz.websocket.isActive();
      if (state.connected) {
        state.printers = await window.qz.printers.find();
        logAudit({ modulo: 'impresion', accion: 'qz_connect', entidad: 'qz', entidad_id: 'qz', observacion: 'Conectado correctamente' });
      }
      return { ok: state.connected, printers: state.printers };
    } catch (error) {
      state.connected = false;
      logAudit({ modulo: 'impresion', accion: 'qz_connect_error', entidad: 'qz', entidad_id: 'qz', resultado: 'ERROR', observacion: String(error) });
      return { ok: false, error: String(error) };
    }
  }
  return { ok: false, error: 'QZ Tray no disponible. Instale y ejecute QZ Tray.' };
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
  return `\x1B\x40\nASTRAPU\nGUIA: ${data.guia}\nCLIENTE: ${data.cliente}\nMONTO: RD$ ${data.monto}\n\nGracias por preferirnos\n\x1D\x56\x41`;
}

function zplLabel(data) {
  return `^XA^CF0,30^FO30,30^FDGUIA ${data.guia}^FS^FO30,80^FDDESTINO ${data.destino}^FS^FO30,130^FDBARCODE ${data.codigo_barras}^FS^XZ`;
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
