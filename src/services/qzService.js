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
  // W=42 for 80mm thermal paper (normal font).
  // BIG (\x1B\x21\x38) = double-width+height so only 21 chars fit per line.
  const W     = 42;
  const WBIG  = 21;
  const SEP   = '-'.repeat(W);
  const EQ    = '='.repeat(W);

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
  const msgFinal = (pcfg.mensaje_final  || 'Artículos dejados después de 30 días pierden el derecho a reclamo.').slice(0, W);
  const telLine  = [
    pcfg.telefono ? `Telefono: ${pcfg.telefono}` : '',
  ].filter(Boolean).join('').slice(0, W);
  const rncLine  = pcfg.rnc ? `RNC: ${pcfg.rnc}`.slice(0, W) : '';

  const total    = parseFloat(data.monto) || 0;
  const subtotal = total / 1.18;
  const itbis    = total - subtotal;
  const fmtNum   = (n) => n.toFixed(2);
  const rFmt     = (n) => `RD$ ${fmtNum(n)}`;

  // Right-align a label+value pair within W chars
  const rAlign = (label, val) => {
    const sp = W - label.length - val.length;
    return label + (sp > 0 ? ' '.repeat(sp) : ' ') + val + '\n';
  };

  // Right-align within BIG-mode width (21 double-width chars = 42 normal chars)
  const rAlignBig = (label, val) => {
    const sp = WBIG - label.length - val.length;
    return label + (sp > 0 ? ' '.repeat(sp) : ' ') + val + '\n';
  };

  // Word-wrap helper
  const wrap = (str) => {
    const words = String(str || '').split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + (line ? ' ' : '') + w).length > W) { lines.push(line); line = w; }
      else { line = line ? line + ' ' + w : w; }
    }
    if (line) lines.push(line);
    return lines.join('\n') + '\n';
  };

  const fecha = data.fecha
    ? new Date(data.fecha).toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Items table: columns [unit+desc 16] [precio 9] [itbis 8] [total 9] = 42
  const itemHeader = 'Cant.'.padEnd(16) + 'Precio'.padStart(9) + 'ITBIS'.padStart(8) + 'Total'.padStart(9);
  const itemRow    = '1 Bulto'.padEnd(16) + fmtNum(subtotal).padStart(9) + fmtNum(itbis).padStart(8) + fmtNum(total).padStart(9);

  return [
    '\x1B\x40',                                    // initialize

    // ── HEADER ──
    CTR, BIG, `${nombre}\n`,                       // company name: max size centered
    NORMAL, `${sub}\n`,                            // subtitle: normal centered
    telLine  ? `${telLine}\n`  : '',
    rncLine  ? `${rncLine}\n`  : '',
    `${SEP}\n`,

    // ── INVOICE INFO ──
    LEFT,
    DH, `Factura#: ${data.guia}\n`,               // invoice number: double-height
    NORMAL,
    `(${data.metodo_pago || 'EFECTIVO'})\n`,
    `Fecha: ${fecha}\n`,
    data.operador ? `Vendedor: ${data.operador}\n` : '',
    `${SEP}\n`,

    // ── CLIENTE / REMITENTE ──
    BOLD_ON, 'REMITENTE:\n', BOLD_OFF,
    `${String(data.cliente || '-').slice(0, W)}\n`,
    data.telefono_cliente ? `Tel: ${data.telefono_cliente}\n` : '',
    `${SEP}\n`,

    // ── DESTINO ──
    BOLD_ON, 'DESTINO:\n', BOLD_OFF,
    `${String(data.destino || '-').slice(0, W)}\n`,
    data.origen ? `Origen: ${String(data.origen).slice(0, W - 8)}\n` : '',
    `${SEP}\n`,

    // ── ITEMS TABLE ──
    `${itemHeader}\n`,
    `${SEP}\n`,
    wrap(data.descripcion || 'Paquete'),
    data.color ? `Color/Empaque: ${String(data.color).slice(0, W - 15)}\n` : '',
    `${itemRow}\n`,
    `${SEP}\n`,

    // ── SUBTOTALS ──
    rAlign('Sub Total:', `$${fmtNum(subtotal)}`),
    rAlign('Descuento:', '0.00'),
    rAlign('Recargo:', '0.00'),
    rAlign('ITBIS:', `$${fmtNum(itbis)}`),
    `${SEP}\n`,

    // ── TOTAL: big font (W=21) ──
    BIG,
    rAlignBig('TOTAL', fmtNum(total)),
    NORMAL,
    `${EQ}\n`,

    // ── PAYMENT ──
    rAlign('Pago:', rFmt(total)),
    rAlign('Devuelta:', 'RD$ 0.00'),
    `${EQ}\n`,

    // ── FOOTER ──
    CTR,
    `\n${msgFinal}\n`,
    NORMAL,
    '\n\n',
    '\x1D\x56\x41',                                // cut paper
  ].join('');
}

function htmlLabel(data) {
  const pcfg    = db.configuracion_impresoras;
  const nombre  = pcfg.nombre_empresa || 'ASTRAPU';
  const sub     = pcfg.subtitulo      || 'Paquetería Interprovincial RD';
  const tel     = pcfg.telefono ? `Tel: ${pcfg.telefono}` : '';
  const rnc     = pcfg.rnc      ? `RNC: ${pcfg.rnc}`      : '';
  const guia    = data.guia    || '';
  const dest    = data.destino || '-';
  const orig    = data.origen  || '';
  const barcode = data.codigo_barras || data.guia || '';

  // Simulate a Code 128-style barcode as alternating thin/wide bars using CSS
  // (real barcode font not available, but QZ Tray renders this fine on screen)
  const barsHtml = (() => {
    let bars = '';
    for (let i = 0; i < barcode.length + 10; i++) {
      const w = (i % 3 === 0) ? 3 : 1;
      const fill = (i % 2 === 0) ? '#000' : '#fff';
      bars += `<span style="display:inline-block;width:${w}px;height:28px;background:${fill};vertical-align:top"></span>`;
    }
    return bars;
  })();

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; background: #fff; }
  .label {
    width: 130mm; border: 2px solid #000;
    padding: 3mm 4mm; display: flex; flex-direction: column; gap: 2mm;
  }
  .top { display:flex; justify-content:space-between; align-items:flex-start;
         border-bottom:1px solid #000; padding-bottom:2mm; margin-bottom:1mm; }
  .brand h1 { font-size:15pt; font-weight:900; line-height:1.1; }
  .brand p  { font-size:7pt; color:#444; line-height:1.4; }
  .guia     { font-size:13pt; font-weight:900; white-space:nowrap; text-align:right; }
  .mid      { display:grid; grid-template-columns:1.5fr 1fr; gap:2mm; }
  .field label { font-size:6pt; font-weight:700; text-transform:uppercase;
                 color:#555; display:block; }
  .field.dest span { font-size:12pt; font-weight:900; line-height:1.2; }
  .field span { font-size:9pt; font-weight:700; display:block; line-height:1.2; }
  .barwrap { border-top:1px solid #000; padding-top:2mm; text-align:center; }
  .barcode { display:inline-flex; height:28px; gap:0; }
  .barnum  { font-size:7pt; letter-spacing:1px; font-family:monospace; margin-top:1mm; }
</style>
</head><body>
<div class="label">
  <div class="top">
    <div class="brand">
      <h1>${nombre}</h1>
      <p>${sub}</p>
      ${tel ? `<p>${tel}${rnc ? '  ' + rnc : ''}</p>` : (rnc ? `<p>${rnc}</p>` : '')}
    </div>
    <div class="guia">${guia}</div>
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
  <div class="barwrap">
    <div class="barcode">${barsHtml}</div>
    <div class="barnum">${barcode}</div>
  </div>
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
    // Let the printer use its own paper size (A4 portrait by default).
    // The @page CSS in the HTML controls margins; the label box controls the printed area.
    const config = window.qz.configs.create(printerName, {
      colorType: 'blackwhite',
      copies: 1,
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
