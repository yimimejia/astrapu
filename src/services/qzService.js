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
    // setCertificatePromise y setSignaturePromise deben configurarse ANTES de connect().
    // setSignatureAlgorithm SOLO funciona DESPUÉS de connect() — QZ Tray lo ignora antes
    // (verifica compatibilidad con el servidor Java al momento de la conexión).
    qz.security.setCertificatePromise((resolve, reject) => {
      fetchCertificate().then(resolve).catch(reject);
    });

    qz.security.setSignaturePromise(async (toSign) => {
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

    // setSignatureAlgorithm DESPUÉS de connect(): así QZ Tray ya marcó la compatibilidad
    // y no ignora la llamada. SHA512 debe coincidir con el algoritmo del backend.
    qz.security.setSignatureAlgorithm('SHA512');

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
  const pcfg = db.configuracion_impresoras;
  const W   = 42;
  const SEP = '-'.repeat(W);
  const EQ  = '='.repeat(W);

  const nombre   = (pcfg.nombre_empresa || 'ASTRAPU').slice(0, W);
  const sub      = (pcfg.subtitulo      || 'Paquetería Interprovincial RD').slice(0, W);
  const msgFinal = (pcfg.mensaje_final  || 'Gracias por preferirnos').slice(0, W);
  const telRnc   = [
    pcfg.telefono ? `Tel: ${pcfg.telefono}` : '',
    pcfg.rnc      ? `RNC: ${pcfg.rnc}`      : '',
  ].filter(Boolean).join('  ').slice(0, W);

  const total    = parseFloat(data.monto) || 0;
  const subtotal = total / 1.18;
  const itbis    = total - subtotal;
  const rFmt     = (n) => `RD$ ${n.toFixed(2)}`;
  const rAlign   = (label, val) => {
    const sp = W - label.length - val.length;
    return label + (sp > 0 ? ' '.repeat(sp) : ' ') + val + '\n';
  };
  const wrap = (str, prefix = '  ') => {
    const words = String(str || '').split(' ');
    const lines = [];
    let line = prefix;
    for (const w of words) {
      if ((line + w).length > W) { lines.push(line.trimEnd()); line = prefix + w + ' '; }
      else { line += w + ' '; }
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines.join('\n') + '\n';
  };

  const fecha = data.fecha
    ? new Date(data.fecha).toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return [
    '\x1B\x40',
    '\x1B\x61\x01',
    '\x1B\x21\x38',
    `${nombre}\n`,
    '\x1B\x21\x00',
    `${sub}\n`,
    telRnc ? `${telRnc}\n` : '',
    `${EQ}\n`,
    '\x1B\x61\x00',
    `GUIA: ${data.guia}\n`,
    `Fecha: ${fecha}\n`,
    data.operador ? `Operador: ${data.operador}\n` : '',
    `Pago: ${data.metodo_pago || 'EFECTIVO'}\n`,
    `${SEP}\n`,
    '\x1B\x45\x01',
    'REMITENTE:\n',
    '\x1B\x45\x00',
    `  ${String(data.cliente || '').slice(0, W - 2)}\n`,
    data.telefono_cliente ? `  Tel: ${data.telefono_cliente}\n` : '',
    '\n',
    '\x1B\x45\x01',
    `DESTINO: ${String(data.destino || '-').slice(0, W - 10)}\n`,
    '\x1B\x45\x00',
    data.origen ? `Origen:  ${String(data.origen).slice(0, W - 9)}\n` : '',
    `${SEP}\n`,
    '\x1B\x45\x01',
    'DESCRIPCION DEL PAQUETE:\n',
    '\x1B\x45\x00',
    wrap(data.descripcion || 'Paquete'),
    data.color ? `  Color/Empaque: ${String(data.color).slice(0, 24)}\n` : '',
    `  Cant: 1 Bulto\n`,
    `${SEP}\n`,
    rAlign('Subtotal:', rFmt(subtotal)),
    rAlign('ITBIS (18%):', rFmt(itbis)),
    `${SEP}\n`,
    '\x1B\x21\x10',
    '\x1B\x45\x01',
    rAlign('TOTAL:', rFmt(total)),
    '\x1B\x21\x00',
    '\x1B\x45\x00',
    `${EQ}\n`,
    '\x1B\x61\x01',
    `${msgFinal}\n`,
    '\n\n',
    '\x1D\x56\x41',
  ].join('');
}

function zplLabel(data) {
  const pcfg = db.configuracion_impresoras;
  const nombre = (pcfg.nombre_empresa || 'ASTRAPU').slice(0, 40);
  const sub    = (pcfg.subtitulo      || '').slice(0, 40);
  return [
    '^XA',
    '^CF0,40',
    `^FO40,30^FD${nombre}^FS`,
    sub ? `^CF0,24^FO40,80^FD${sub}^FS` : '',
    `^CF0,28`,
    `^FO40,${sub ? 120 : 90}^FDGUIA: ${data.guia}^FS`,
    `^FO40,${sub ? 160 : 130}^FDDESTINO: ${data.destino}^FS`,
    `^FO40,${sub ? 210 : 180}^BY2^BCN,80,Y,N,N^FD${data.codigo_barras || data.guia}^FS`,
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
