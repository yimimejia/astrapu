import { VIEW_LABELS, PACKAGE_STATUS } from './constants.js';
import { db } from './data/store.js';
import { getCurrentUser, canEdit } from './services/authService.js';
import { resumenPendientes } from './services/salesService.js';
import { buildReports } from './services/reportsService.js';
import { qzState, getPrinterConfig } from './services/qzService.js';

export function menuButton(view, active) {
  return `<button class="menu-item ${active ? 'active' : ''}" data-view="${view}">${VIEW_LABELS[view]}</button>`;
}

const badge = (status) => `<span class="badge ${status.toLowerCase()}">${status.replace('_', ' ')}</span>`;
const table = (headers, rows) => `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function renderView(view) {
  const user = getCurrentUser();
  const readOnly = !canEdit();

  const commonHeader = `<div class="notice">Regla maestra: la guía interna (<b>GUIA-000000001</b>) es independiente del documento fiscal.</div>`;

  const views = {
    dashboard: () => `${commonHeader}<div class="kpis">${kpis()}</div>${panelPaquetes()}`,
    dashboard_contable: () => `${commonHeader}<div class="readonly-banner">MODO CONTABLE - SOLO LECTURA TOTAL</div><div class="kpis">${kpis()}</div>${panelCuadres()}`,
    paquetes: () => panelPaquetes(),
    clientes: () => panelClientes(),
    sucursales: () => simplePanel('Sucursales', table(['Nombre', 'Provincia'], db.sucursales.map((s) => [s.nombre, s.provincia]))),
    usuarios: () => simplePanel('Usuarios', table(['Usuario', 'Nombre', 'Rol', 'Sucursal'], db.usuarios.map((u) => [u.username, u.nombre, u.rol, db.sucursales.find((s) => s.id === u.sucursal_id)?.nombre || '-']))),
    cuadres: () => panelCuadres(),
    auditoria: () => panelAuditoria(),
    reportes: () => panelReportes(),
    facturacion: () => panelFiscal(),
    configuracion: () => simplePanel('Configuración', '<p>Parámetros generales y seguridad de la plataforma.</p>'),
    impresoras: () => panelImpresoras(),

    nuevo_envio: () => panelNuevoEnvio(readOnly),
    enviar_paquetes: () => panelEscaneo('enviar'),
    historial_ventas: () => panelVentas(),
    cierre_caja: () => panelCierre(readOnly),
    mi_historial: () => panelMiHistorial(user.id),
    perfil: () => panelPerfil(user),

    recibir_paquetes: () => panelEscaneo('recibir'),
    buscar_paquete: () => panelBuscar(),
    entregar_paquete: () => panelEntregar(),
    paquetes_entregados: () => panelEntregados(),
    ventas: () => panelVentas(),
  };

  return (views[view] ? views[view]() : '<div class="panel">Vista no encontrada.</div>');
}

function kpis() {
  return [
    ['Paquetes totales', db.paquetes.length],
    ['Ventas hoy', db.ventas.length],
    ['Cierres', db.cierres_caja.length],
    ['Eventos auditoría', db.auditoria.length],
  ].map(([t, v]) => `<article class="kpi"><p>${t}</p><h3>${v}</h3></article>`).join('');
}

function simplePanel(title, content) {
  return `<section class="panel"><header class="panel-header"><h3>${title}</h3></header>${content}</section>`;
}

function panelPaquetes() {
  return simplePanel('Paquetes', `<div class="table-wrap">${table(['Guía', 'Cliente', 'Estado', 'Origen', 'Destino', 'Registro'], db.paquetes.map((p) => [p.guia, db.clientes.find((c) => c.id === p.cliente_id)?.nombre || '-', badge(p.estado), db.sucursales.find((s) => s.id === p.sucursal_origen)?.nombre || '-', db.sucursales.find((s) => s.id === p.sucursal_destino)?.nombre || '-', p.created_at.slice(0, 16).replace('T', ' ') ]))}</div>`);
}

function panelClientes() {
  return simplePanel('Clientes', `<div class="table-wrap">${table(['Teléfono', 'Nombre', 'Cédula', 'Dirección'], db.clientes.map((c) => [c.telefono, c.nombre, c.cedula || '-', c.direccion || '-']))}</div>`);
}

function panelNuevoEnvio(readOnly) {
  const options = db.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  return `
    <section class="panel">
      <header class="panel-header"><h3>Registro de envío</h3></header>
      <form id="formEnvio" class="form-grid">
        <label>Teléfono del cliente<input name="telefono" required /></label>
        <label>Nombre del cliente<input name="nombre" required /></label>
        <label>Cédula<input name="cedula" /></label>
        <label>Dirección<input name="direccion" /></label>
        <label>Descripción del artículo<input name="descripcion" required /></label>
        <label>Color del empaque<input name="color_empaque" required /></label>
        <label>Monto a cobrar<input name="monto" type="number" min="0" step="0.01" required /></label>
        <label>Sucursal origen<select name="sucursal_origen">${options}</select></label>
        <label>Sucursal destino<select name="sucursal_destino">${options}</select></label>
        <label class="full">Observación opcional<textarea name="observacion"></textarea></label>
        <div class="full actions">
          <button ${readOnly ? 'disabled' : ''} class="btn primary" data-action="registrar-envio" type="submit">Registrar envío</button>
          <button ${readOnly ? 'disabled' : ''} class="btn" type="button" data-action="reimprimir-ultimo">Reimprimir último comprobante</button>
        </div>
      </form>
      <div id="autocompleteCliente" class="hint">Escriba teléfono para autocompletar cliente.</div>
      <div id="previewEnvio" class="preview"></div>
    </section>`;
}

function panelEscaneo(mode) {
  const isEnviar = mode === 'enviar';
  const status = isEnviar ? 'PENDIENTE' : 'EN_TRANSITO';
  const title = isEnviar ? 'Modo escaneo de salida' : 'Modo recepción';
  return `<section class="panel"><header class="panel-header"><h3>${VIEW_LABELS[isEnviar ? 'enviar_paquetes' : 'recibir_paquetes']}</h3></header>
      <div class="scan-zone">
        <h2>${title}</h2>
        <input id="scanInput" data-mode="${mode}" placeholder="Escanee código sin presionar Enter" autofocus />
        <p>Validación esperada: estado ${status}.</p>
        <div id="scanFeedback" class="hint"></div>
      </div>
      <div class="table-wrap" id="scanTable"></div>
    </section>`;
}

function panelBuscar() {
  return `<section class="panel"><header class="panel-header"><h3>Buscar paquete por teléfono</h3></header>
    <input id="buscarTelefono" placeholder="8095550000" />
    <div id="resultadoBusqueda" class="result-cards"></div>
  </section>`;
}

function panelEntregar() {
  return `<section class="panel"><header class="panel-header"><h3>Entrega con doble validación</h3></header>
    <div class="steps"><span class="active">1 Buscar</span><span>2 Cédula</span><span>3 Escaneo final</span><span>4 Confirmar</span></div>
    <div id="entregaSeleccion" class="preview">Seleccione un paquete desde Buscar paquete.</div>
    <label>Cédula destinatario<input id="cedulaEntrega" /></label>
    <label>Escaneo final<input id="scanEntrega" placeholder="Escanee guía o código de barras" /></label>
    <button class="btn primary" id="confirmarEntregaBtn">Confirmar entrega</button>
    <div id="entregaFeedback" class="hint error"></div>
  </section>`;
}

function panelEntregados() {
  const entregados = db.paquetes.filter((p) => p.estado === PACKAGE_STATUS.ENTREGADO);
  return simplePanel('Paquetes entregados', `<div class="filters">Filtros: fecha, usuario, sucursal, teléfono, guía</div><div class="table-wrap">${table(['Guía', 'Cliente', 'Teléfono', 'Fecha/Hora', 'Usuario', 'Sucursal'], entregados.map((p) => [p.guia, db.clientes.find((c) => c.id === p.cliente_id)?.nombre || '-', p.telefono_destinatario, p.entregado_at?.slice(0,16).replace('T',' ') || '-', db.usuarios.find((u)=>u.id===p.usuario_id)?.username || '-', db.sucursales.find((s)=>s.id===p.sucursal_destino)?.nombre || '-' ]))}</div>`);
}

function panelVentas() {
  return simplePanel('Ventas', `<div class="table-wrap">${table(['Guía', 'Cliente', 'Monto', 'Método', 'Fecha/Hora', 'En cierre'], db.ventas.map((v) => [v.guia, v.cliente, `RD$ ${v.monto.toFixed(2)}`, v.metodo_pago, v.fecha_hora.slice(0,16).replace('T',' '), v.cierre_id ? 'Sí' : 'No']))}</div><button class="btn" data-action="hacer-cierre">Hacer cierre</button>`);
}

function panelCierre(readOnly) {
  const r = resumenPendientes();
  return simplePanel('Cierre de caja', `
    <div class="kpis">
      <article class="kpi"><p>Cantidad ventas</p><h3>${r.cantidad}</h3></article>
      <article class="kpi"><p>Total general</p><h3>RD$ ${r.total.toFixed(2)}</h3></article>
      <article class="kpi"><p>Efectivo esperado</p><h3>RD$ ${r.efectivo.toFixed(2)}</h3></article>
      <article class="kpi"><p>Transferencia/Tarjeta/Otros</p><h3>RD$ ${(r.transferencia + r.tarjeta + r.otros).toFixed(2)}</h3></article>
    </div>
    <form id="formCierre" class="form-grid">
      <label>Monto contado<input name="monto_contado" type="number" /></label>
      <label class="full">Observación<textarea name="observacion"></textarea></label>
      <button ${readOnly ? 'disabled' : ''} class="btn primary" data-action="confirmar-cierre">Confirmar cierre</button>
    </form>`);
}

function panelCuadres() {
  return simplePanel('Cuadres registrados', `<div class="table-wrap">${table(['Cierre', 'Fecha/Hora', 'Usuario', 'Sucursal', 'Total', 'Diferencia'], db.cierres_caja.map((c) => [c.id, c.fecha_hora.slice(0,16).replace('T',' '), db.usuarios.find((u)=>u.id===c.usuario_id)?.username || '-', db.sucursales.find((s)=>s.id===c.sucursal_id)?.nombre || '-', `RD$ ${c.total_general.toFixed(2)}`, `RD$ ${c.diferencia.toFixed(2)}`]))}</div>`);
}

function panelAuditoria() {
  return simplePanel('Auditoría (inmutable desde UI)', `<div class="filters">Filtros: usuario, fecha, módulo, acción, entidad, sucursal</div><div class="table-wrap">${table(['Fecha/Hora', 'Usuario', 'Módulo', 'Acción', 'Entidad', 'Resultado'], db.auditoria.slice(0, 100).map((a) => [a.fecha_hora.slice(0, 19).replace('T', ' '), a.usuario, a.modulo, a.accion, `${a.entidad}:${a.entidad_id}`, a.resultado]))}</div>`);
}

function panelReportes() {
  const r = buildReports();
  return simplePanel('Reportes y tiempos de ruta', `<div class="kpis"><article class="kpi"><p>Paquetes por sucursal</p><h3>${r.bySucursal.length}</h3></article><article class="kpi"><p>Estados activos</p><h3>${r.byEstado.length}</h3></article><article class="kpi"><p>Rutas analizadas</p><h3>${r.tiemposRuta.length}</h3></article></div><div class="table-wrap">${table(['Ruta', 'Muestras', 'Promedio (min)', 'Estado'], r.tiemposRuta.map((x) => [x.ruta, x.muestras, x.promedio_min, x.estado]))}</div>`);
}

function panelFiscal() {
  return simplePanel('Facturación electrónica (desacoplada)', `
    <div class="notice warning">MODO PREPARACIÓN: integración DGII y firmado digital desacoplados, listos para conectar.</div>
    <div class="fiscal-menu">${['Resumen fiscal','Configuración fiscal','Certificación / preparación','Emisión de e-CF','Notas crédito/débito','Documentos emitidos','Consulta de estados','Anulaciones','Cola de envío / reintentos','Eventos fiscales / bitácora'].map((x)=>`<span>${x}</span>`).join('')}</div>
    <div class="hint">Estados internos: borrador, listo_para_firmar, firmado, enviado, en_proceso, aceptado, aceptado_condicional, rechazado, anulado, error_tecnico.</div>
    <div class="table-wrap">${table(['ID', 'Estado', 'Venta', 'TrackId'], db.documentos_fiscales.map((d) => [d.id, d.estado, d.venta_id || '-', d.track_id || '-']))}</div>
  `);
}

function panelImpresoras() {
  const qz = qzState();
  const cfg = getPrinterConfig();
  return simplePanel('Configuración de impresoras (QZ Tray)', `
    <div class="notice ${qz.connected ? 'success' : 'error'}">Estado QZ Tray: ${qz.connected ? 'Conectado' : 'Desconectado'} | Signing: ${qz.signingMode}</div>
    <form id="printerForm" class="form-grid">
      <label>Impresora térmica<select name="termica" id="printerTermica"></select></label>
      <label>Impresora adhesiva<select name="adhesiva" id="printerAdhesiva"></select></label>
      <div class="actions full">
        <button class="btn" data-action="connect-qz" type="button">Conectar QZ</button>
        <button class="btn" data-action="save-printers" type="button">Guardar configuración</button>
        <button class="btn" data-action="test-termica" type="button">Probar impresora térmica</button>
        <button class="btn" data-action="test-adhesiva" type="button">Probar impresora adhesiva</button>
      </div>
    </form>
    <div class="hint">Seleccionado: térmica=${cfg.termica || '-'} | adhesiva=${cfg.adhesiva || '-'}</div>
    <div id="printFeedback" class="hint"></div>
  `);
}

function panelMiHistorial(userId) {
  const items = db.auditoria.filter((a) => db.usuarios.find((u) => u.username === a.usuario)?.id === userId);
  return simplePanel('Mi historial', `<div class="table-wrap">${table(['Fecha/Hora', 'Acción', 'Módulo', 'Resultado'], items.map((x) => [x.fecha_hora.slice(0,19).replace('T',' '), x.accion, x.modulo, x.resultado]))}</div>`);
}

function panelPerfil(user) {
  return simplePanel('Perfil', `<div class="preview"><p><b>Nombre:</b> ${user.nombre}</p><p><b>Usuario:</b> ${user.username}</p><p><b>Rol:</b> ${user.rol}</p><p><b>Sucursal:</b> ${db.sucursales.find((s)=>s.id===user.sucursal_id)?.nombre || '-'}</p></div>`);
}
