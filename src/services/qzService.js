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
  // W=42 for 80mm paper with normal font.
  // Double-height mode (\x1B\x21\x10) keeps the same width but makes chars taller.
  const W   = 42;
  const SEP = '-'.repeat(W);
  const EQ  = '='.repeat(W);

  // ESC/POS font modes
  const NORMAL   = '\x1B\x21\x00';           // normal
  const DH       = '\x1B\x21\x10';           // double height
  const BOLD_DH  = '\x1B\x21\x18';           // bold + double height
  const BIG      = '\x1B\x21\x38';           // bold + double width + double height (max)
  const BOLD_ON  = '\x1B\x45\x01';
  const BOLD_OFF = '\x1B\x45\x00';
  const CTR      = '\x1B\x61\x01';           // center
  const LEFT     = '\x1B\x61\x00';           // left

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

  // Right-aligned row — same width as normal font (DH doesn't change width)
  const rAlign = (label, val) => {
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
    '\x1B\x40',                              // initialize printer
    CTR, BIG, `${nombre}\n`,                 // company name — max size, centered
    DH,  `${sub}\n`,                         // subtitle — double height, centered
    NORMAL, telRnc ? `${telRnc}\n` : '',     // tel/RNC — normal, centered
    `${EQ}\n`,
    LEFT,
    DH, `GUIA: ${data.guia}\n`,              // guide number — double height
    NORMAL, `Fecha: ${fecha}\n`,
    data.operador ? `Operador: ${data.operador}\n` : '',
    `Pago: ${data.metodo_pago || 'EFECTIVO'}\n`,
    `${SEP}\n`,
    BOLD_DH, 'REMITENTE:\n',                 // section header — bold + double height
    DH, `  ${String(data.cliente || '').slice(0, W - 2)}\n`,
    data.telefono_cliente ? DH + `  Tel: ${data.telefono_cliente}\n` : '',
    '\n',
    BOLD_DH, `DESTINO:\n`,
    DH, `  ${String(data.destino || '-').slice(0, W - 2)}\n`,
    data.origen ? NORMAL + `  Origen: ${String(data.origen).slice(0, W - 10)}\n` : '',
    `${SEP}\n`,
    BOLD_DH, 'DESCRIPCION DEL PAQUETE:\n',
    DH, wrap(data.descripcion || 'Paquete'),
    data.color ? `  Color/Empaque: ${String(data.color).slice(0, 24)}\n` : '',
    `  Cant: 1 Bulto\n`,
    `${SEP}\n`,
    NORMAL,
    rAlign('Subtotal:', rFmt(subtotal)),
    rAlign('ITBIS (18%):', rFmt(itbis)),
    `${SEP}\n`,
    BIG, BOLD_ON,
    rAlign('TOTAL:', rFmt(total)),
    NORMAL, BOLD_OFF,
    `${EQ}\n`,
    CTR, DH, `${msgFinal}\n`,
    NORMAL,
    '\n\n',
    '\x1D\x56\x41',                          // cut paper
  ].join('');
}

function htmlLabel(data) {
  const pcfg   = db.configuracion_impresoras;
  const nombre = pcfg.nombre_empresa || 'ASTRAPU';
  const sub    = pcfg.subtitulo      || 'Paquetería Interprovincial RD';
  const tel    = pcfg.telefono ? `Tel: ${pcfg.telefono}` : '';
  const rnc    = pcfg.rnc      ? `RNC: ${pcfg.rnc}`      : '';
  const guia   = data.guia   || '';
  const dest   = data.destino || '-';
  const orig   = data.origen  || '';
  const barcode = data.codigo_barras || data.guia || '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;width:148mm;height:100mm;padding:4mm;
       border:1px solid #000;background:#fff;display:flex;flex-direction:column;gap:2mm}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #000;padding-bottom:2mm}
  .brand{flex:1}
  .brand h1{font-size:18pt;font-weight:900;line-height:1}
  .brand p{font-size:7pt;color:#444}
  .qr{width:22mm;height:22mm;display:flex;align-items:center;justify-content:center;border:1px dashed #ccc;font-size:6pt;color:#999;text-align:center}
  .mid{display:grid;grid-template-columns:1fr 1fr;gap:2mm;flex:1}
  .field label{font-size:6pt;font-weight:700;text-transform:uppercase;color:#666;display:block}
  .field span{font-size:10pt;font-weight:700;display:block;line-height:1.2}
  .field.dest span{font-size:13pt;font-weight:900;color:#000}
  .bar{text-align:center;border-top:1px solid #000;padding-top:1.5mm}
  .bartext{font-size:8pt;font-weight:700;letter-spacing:1px;font-family:monospace}
  .guia-big{font-size:14pt;font-weight:900;letter-spacing:1px}
</style>
</head><body>
  <div class="top">
    <div class="brand">
      <h1>${nombre}</h1>
      <p>${sub}</p>
      ${tel ? `<p>${tel}${rnc ? '  ' + rnc : ''}</p>` : (rnc ? `<p>${rnc}</p>` : '')}
    </div>
    <div class="guia-big">${guia}</div>
  </div>
  <div class="mid">
    <div class="field dest">
      <label>Destino</label>
      <span>${dest}</span>
    </div>
    <div class="field">
      <label>Origen</label>
      <span>${orig || '—'}</span>
    </div>
  </div>
  <div class="bar">
    <div class="bartext">|||||||||||||||||||||||||||||||||||||||||||||||</div>
    <div style="font-size:7pt;letter-spacing:1.5px;font-family:monospace">${barcode}</div>
  </div>
</body></html>`;
}

function zplLabel(data) {
  const pcfg  = db.configuracion_impresoras;
  const nombre = (pcfg.nombre_empresa || 'ASTRAPU').slice(0, 40);
  const sub    = (pcfg.subtitulo      || '').slice(0, 40);
  const LW     = 800;
  const c      = (y, fs, txt) => `^FO0,${y}^FB${LW},1,,C^CF0,${fs}^FD${txt}^FS`;
  let y = 30;
  const lines = ['^XA', '^PW800'];
  lines.push(c(y, 48, nombre)); y += 60;
  if (sub) { lines.push(c(y, 28, sub)); y += 40; }
  lines.push(`^FO60,${y}^GB680,2,2^FS`); y += 14;
  lines.push(c(y, 32, `GUIA: ${data.guia}`)); y += 44;
  lines.push(c(y, 28, `DESTINO: ${data.destino}`)); y += 38;
  lines.push(`^FO100,${y}^BY3^BCN,90,N,N,N^FD${data.codigo_barras || data.guia}^FS`); y += 110;
  lines.push(c(y, 22, data.codigo_barras || data.guia));
  lines.push('^XZ');
  return lines.join('\n');
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

async function pixelPrint(printerName, htmlContent) {
  if (!state.connected || !window.qz) return { ok: false, error: 'QZ no conectado' };
  try {
    const config = window.qz.configs.create(printerName, {
      units: 'mm',
      size: { width: 148, height: 105 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      colorType: 'blackwhite',
    });
    await window.qz.print(config, [{ type: 'pixel', format: 'html', flavor: 'plain', data: htmlContent }]);
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
  const cfg     = db.configuracion_impresoras;
  const printer = cfg.adhesiva;
  if (!printer) return { ok: false, error: 'Impresora adhesiva no configurada.' };
  const tipo = cfg.adhesiva_tipo || 'normal';
  const result = tipo === 'zpl'
    ? await rawPrint(printer, zplLabel(data))
    : await pixelPrint(printer, htmlLabel(data));
  logAudit({ modulo: 'impresion', accion: 'impresion_etiqueta', entidad: 'historial_impresion', entidad_id: data.guia, resultado: result.ok ? 'OK' : 'ERROR', observacion: result.error || '' });
  return result;
}

export function qzState() {
  return state;
}
