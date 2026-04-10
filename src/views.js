import { VIEW_LABELS, VIEW_ICONS, PACKAGE_STATUS, MENUS } from './constants.js';
import { db } from './data/store.js';
import { getCurrentUser, canEdit } from './services/authService.js';
import { resumenPendientes } from './services/salesService.js';
import { buildReports } from './services/reportsService.js';
import { qzState, getPrinterConfig } from './services/qzService.js';

export function menuButton(view, active) {
  const icon = VIEW_ICONS[view] || '';
  return `<button class="menu-item ${active ? 'active' : ''}" data-view="${view}"><span style="font-size:.9em;opacity:.75;flex-shrink:0">${icon}</span>${VIEW_LABELS[view]}</button>`;
}

const badge = (status) => `<span class="badge ${(status || '').toLowerCase()}">${(status || '').replace('_', ' ')}</span>`;
const th = (h) => `<th>${h}</th>`;
const td = (c) => `<td>${c}</td>`;
const table = (headers, rows) =>
  `<table><thead><tr>${headers.map(th).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody></table>`;

const fmtDate = (d) => (d ? String(d).slice(0, 16).replace('T', ' ') : '-');
const money = (n) => `RD$ ${Number(n || 0).toFixed(2)}`;

export const viewState = {
  paquetes: { search: '', estado: '', selectedId: null },
  clientes: { search: '', showForm: false, editId: null },
  sucursales: { showForm: false, editId: null },
  usuarios: { showForm: false, editId: null },
  auditoria: { page: 1, usuario: '', modulo: '', accion: '', date_from: '', date_to: '' },
  cuadres: { selectedId: null },
  fiscal: { tab: 'estado' },
};

function clienteNombre(clienteId) {
  return db.clientes.find((c) => c.id === clienteId)?.nombre || '-';
}
function sucursalNombre(sucursalId) {
  return db.sucursales.find((s) => s.id === sucursalId)?.nombre || '-';
}
function usuarioUsername(userId) {
  return db.usuarios.find((u) => u.id === userId)?.username || '-';
}

export function renderView(view) {
  const user = getCurrentUser();
  const readOnly = !canEdit();

  const commonHeader = `<div class="notice">Regla maestra: la guía interna (<b>GUIA-000000001</b>) es independiente del documento fiscal.</div>`;

  const views = {
    dashboard: () => `${commonHeader}${panelDashboard()}`,
    dashboard_contable: () => `${commonHeader}<div class="readonly-banner">MODO CONTABLE - SOLO LECTURA TOTAL</div>${panelDashboard()}${panelCuadres()}`,
    paquetes: () => panelPaquetes(),
    clientes: () => panelClientes(readOnly),
    sucursales: () => panelSucursales(readOnly),
    usuarios: () => panelUsuarios(),
    cuadres: () => panelCuadres(),
    auditoria: () => panelAuditoria(),
    reportes: () => panelReportes(),
    facturacion: () => panelFiscal(readOnly),
    configuracion: () => panelConfiguracion(),
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

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

function panelDashboard() {
  const pendientes = db.paquetes.filter((p) => p.estado === 'PENDIENTE').length;
  const enTransito = db.paquetes.filter((p) => p.estado === 'EN_TRANSITO').length;
  const disponibles = db.paquetes.filter((p) => p.estado === 'DISPONIBLE').length;
  const entregados = db.paquetes.filter((p) => p.estado === 'ENTREGADO').length;
  const rol = getCurrentUser().rol;

  const quickLinks = MENUS[rol].slice(0, 4).map((v) =>
    `<button class="btn" data-view="${v}">${VIEW_LABELS[v]}</button>`,
  ).join('');

  return `
  <div class="kpis">
    <article class="kpi clickable" data-filter-estado="PENDIENTE" data-nav="paquetes"><p>Pendientes</p><h3>${pendientes}</h3><small>Ver paquetes →</small></article>
    <article class="kpi clickable" data-filter-estado="EN_TRANSITO" data-nav="paquetes"><p>En tránsito</p><h3>${enTransito}</h3><small>Ver paquetes →</small></article>
    <article class="kpi clickable" data-filter-estado="DISPONIBLE" data-nav="paquetes"><p>Disponibles</p><h3>${disponibles}</h3><small>Ver paquetes →</small></article>
    <article class="kpi clickable" data-filter-estado="ENTREGADO" data-nav="paquetes"><p>Entregados</p><h3>${entregados}</h3><small>Ver paquetes →</small></article>
  </div>
  <section class="panel">
    <header class="panel-header"><h3>Accesos rápidos</h3></header>
    <div class="actions">${quickLinks}</div>
  </section>
  ${panelPaquetes(true)}`;
}

// ─── PAQUETES ─────────────────────────────────────────────────────────────────

function panelPaquetes(compact = false) {
  const { search, estado, selectedId } = viewState.paquetes;
  let data = db.paquetes;
  if (estado) data = data.filter((p) => p.estado === estado);
  if (search) {
    const q = search.toLowerCase();
    data = data.filter((p) =>
      p.guia.toLowerCase().includes(q) ||
      (p.cliente_nombre || clienteNombre(p.cliente_id)).toLowerCase().includes(q) ||
      (p.telefono_destinatario || '').includes(q),
    );
  }

  const estadosBtns = ['', 'PENDIENTE', 'EN_TRANSITO', 'DISPONIBLE', 'ENTREGADO', 'INCIDENCIA'].map((e) =>
    `<button class="btn ${estado === e ? 'primary' : ''}" data-filter-estado="${e}">${e || 'Todos'}</button>`,
  ).join('');

  const rows = data.slice(0, compact ? 10 : 200).map((p) =>
    `<tr class="clickable-row" data-paquete-id="${p.id}">
      <td>${p.guia}</td>
      <td>${p.cliente_nombre || clienteNombre(p.cliente_id)}</td>
      <td>${badge(p.estado)}</td>
      <td>${sucursalNombre(p.sucursal_origen)}</td>
      <td>${sucursalNombre(p.sucursal_destino)}</td>
      <td>${fmtDate(p.created_at)}</td>
      <td><button class="btn btn-sm" data-paquete-id="${p.id}">Detalle</button></td>
    </tr>`,
  ).join('');

  const detailHtml = selectedId ? panelPaqueteDetalle(selectedId) : '';

  if (compact) {
    return `<section class="panel"><header class="panel-header"><h3>Últimos paquetes</h3></header>
      <div class="table-wrap"><table><thead><tr><th>Guía</th><th>Cliente</th><th>Estado</th><th>Origen</th><th>Destino</th><th>Fecha</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>${detailHtml}</section>`;
  }

  return `<section class="panel">
    <header class="panel-header"><h3>Paquetes</h3></header>
    <div class="filters-bar">
      <input id="paqueteSearch" placeholder="Buscar por guía, cliente, teléfono..." value="${search}" />
      <div class="btn-group">${estadosBtns}</div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Guía</th><th>Cliente</th><th>Estado</th><th>Origen</th><th>Destino</th><th>Fecha</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    ${detailHtml}
  </section>`;
}

function panelPaqueteDetalle(paqueteId) {
  const p = db.paquetes.find((x) => x.id === paqueteId);
  if (!p) return '';
  const movimientos = (db.movimientos_paquete || []).filter((m) => m.paquete_id === paqueteId);
  const movHtml = movimientos.length
    ? table(['Fecha', 'De', 'A', 'Usuario', 'Detalle'], movimientos.map((m) => [
        fmtDate(m.created_at || m.fecha_hora),
        m.estado_origen || '–',
        m.estado_destino,
        m.username || usuarioUsername(m.usuario_id),
        m.detalle || '-',
      ]))
    : '<p class="hint">Sin movimientos registrados aún.</p>';

  return `<section class="panel panel-secondary" id="paqueteDetalle">
    <header class="panel-header">
      <h3>Detalle: ${p.guia}</h3>
      <button class="btn btn-sm" data-action="cerrar-detalle-paquete">✕ Cerrar</button>
    </header>
    <div class="detail-grid">
      <div><b>Guía:</b> ${p.guia}</div>
      <div><b>Código barras:</b> ${p.codigo_barras || '-'}</div>
      <div><b>Cliente:</b> ${p.cliente_nombre || clienteNombre(p.cliente_id)}</div>
      <div><b>Teléfono:</b> ${p.telefono_destinatario || '-'}</div>
      <div><b>Descripción:</b> ${p.descripcion || '-'}</div>
      <div><b>Color:</b> ${p.color_empaque || '-'}</div>
      <div><b>Monto:</b> ${money(p.monto)}</div>
      <div><b>Estado:</b> ${badge(p.estado)}</div>
      <div><b>Origen:</b> ${sucursalNombre(p.sucursal_origen)}</div>
      <div><b>Destino:</b> ${sucursalNombre(p.sucursal_destino)}</div>
      <div><b>Registro:</b> ${fmtDate(p.created_at)}</div>
      <div><b>Enviado:</b> ${fmtDate(p.enviado_at)}</div>
      <div><b>Recibido:</b> ${fmtDate(p.recibido_at)}</div>
      <div><b>Entregado:</b> ${fmtDate(p.entregado_at)}</div>
    </div>
    <h4 style="margin-top:1rem">Historial de movimientos</h4>
    <div class="table-wrap" id="movimientosPaquete">${movHtml}</div>
  </section>`;
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────

function panelClientes(readOnly) {
  const { search, showForm, editId } = viewState.clientes;
  let data = db.clientes;
  if (search) {
    const q = search.toLowerCase();
    data = data.filter((c) =>
      c.nombre.toLowerCase().includes(q) ||
      (c.telefono || '').includes(q) ||
      (c.cedula || '').includes(q),
    );
  }

  const rows = data.slice(0, 200).map((c) => {
    const envios = db.paquetes.filter((p) => p.cliente_id === c.id).length;
    const editBtn = !readOnly ? `<button class="btn btn-sm" data-action="editar-cliente" data-id="${c.id}">Editar</button>` : '';
    return `<tr>
      <td>${c.telefono}</td>
      <td>${c.nombre}</td>
      <td>${c.cedula || '-'}</td>
      <td>${c.direccion || '-'}</td>
      <td>${envios}</td>
      <td>${editBtn}</td>
    </tr>`;
  }).join('');

  const editCliente = editId ? db.clientes.find((c) => c.id === editId) : null;

  const formHtml = (showForm || editId) ? `
    <section class="panel panel-secondary" id="clienteForm">
      <header class="panel-header">
        <h3>${editId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
        <button class="btn btn-sm" data-action="cerrar-cliente-form">✕</button>
      </header>
      <form id="formCliente" class="form-grid">
        <label>Teléfono<input name="telefono" required value="${editCliente?.telefono || ''}" /></label>
        <label>Nombre<input name="nombre" required value="${editCliente?.nombre || ''}" /></label>
        <label>Cédula<input name="cedula" value="${editCliente?.cedula || ''}" /></label>
        <label>Dirección<input name="direccion" value="${editCliente?.direccion || ''}" /></label>
        <input type="hidden" name="_editId" value="${editId || ''}" />
        <div class="actions full">
          <button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Registrar cliente'}</button>
        </div>
      </form>
    </section>` : '';

  const newBtn = !readOnly ? `<button class="btn primary" data-action="nuevo-cliente">+ Nuevo cliente</button>` : '';

  return `<section class="panel">
    <header class="panel-header"><h3>Clientes</h3>${newBtn}</header>
    <div class="filters-bar">
      <input id="clienteSearch" placeholder="Buscar por nombre, teléfono, cédula..." value="${search}" />
    </div>
    <div class="table-wrap">${table(
      ['Teléfono', 'Nombre', 'Cédula', 'Dirección', 'Envíos', ''],
      [],
    ).replace('<tbody></tbody>', `<tbody>${rows}</tbody>`)}</div>
    ${formHtml}
  </section>`;
}

// ─── SUCURSALES ───────────────────────────────────────────────────────────────

function panelSucursales(readOnly) {
  const { showForm, editId } = viewState.sucursales;
  const editSuc = editId ? db.sucursales.find((s) => s.id === editId) : null;

  const rows = db.sucursales.map((s) => {
    const cnt = db.paquetes.filter((p) => p.sucursal_origen === s.id || p.sucursal_destino === s.id).length;
    const editBtn = !readOnly ? `<button class="btn btn-sm" data-action="editar-sucursal" data-id="${s.id}">Editar</button>` : '';
    const delBtn = !readOnly && cnt === 0 ? `<button class="btn btn-sm danger" data-action="eliminar-sucursal" data-id="${s.id}" data-nombre="${s.nombre}">Eliminar</button>` : '';
    return `<tr><td>${s.nombre}</td><td>${s.provincia}</td><td>${cnt} paquetes</td><td style="display:flex;gap:.3rem;flex-wrap:wrap">${editBtn}${delBtn}</td></tr>`;
  }).join('');

  const formHtml = (showForm || editId) ? `
    <section class="panel panel-secondary">
      <header class="panel-header">
        <h3>${editId ? 'Editar sucursal' : 'Nueva sucursal'}</h3>
        <button class="btn btn-sm" data-action="cerrar-sucursal-form">✕</button>
      </header>
      <form id="formSucursal" class="form-grid">
        <label>Nombre<input name="nombre" required value="${editSuc?.nombre || ''}" /></label>
        <label>Provincia<input name="provincia" required value="${editSuc?.provincia || ''}" /></label>
        <input type="hidden" name="_editId" value="${editId || ''}" />
        <div class="actions full">
          <button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Crear sucursal'}</button>
        </div>
      </form>
    </section>` : '';

  const newBtn = !readOnly ? `<button class="btn primary" data-action="nueva-sucursal">+ Nueva sucursal</button>` : '';

  return `<section class="panel">
    <header class="panel-header"><h3>Sucursales</h3>${newBtn}</header>
    <div class="table-wrap">${table(['Nombre', 'Provincia', 'Actividad', ''], []).replace('<tbody></tbody>', `<tbody>${rows}</tbody>`)}</div>
    ${formHtml}
  </section>`;
}

// ─── USUARIOS ─────────────────────────────────────────────────────────────────

function panelUsuarios() {
  const { showForm, editId } = viewState.usuarios;
  const editUser = editId ? db.usuarios.find((u) => u.id === editId) : null;

  const rows = db.usuarios.map((u) => {
    const actBadge = u.activo ? '<span class="badge disponible">Activo</span>' : '<span class="badge incidencia">Inactivo</span>';
    return `<tr>
      <td>${u.username}</td>
      <td>${u.nombre}</td>
      <td>${u.rol.toUpperCase()}</td>
      <td>${sucursalNombre(u.sucursal_id)}</td>
      <td>${actBadge}</td>
      <td>
        <button class="btn btn-sm" data-action="editar-usuario" data-id="${u.id}">Editar</button>
        <button class="btn btn-sm" data-action="toggle-usuario" data-id="${u.id}" data-activo="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>
      </td>
    </tr>`;
  }).join('');

  const sucOptions = db.sucursales.map((s) => `<option value="${s.id}" ${editUser?.sucursal_id === s.id ? 'selected' : ''}>${s.nombre}</option>`).join('');
  const rolOptions = ['admin', 'envios', 'entrega', 'contable'].map((r) => `<option value="${r}" ${editUser?.rol === r ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('');

  const formHtml = (showForm || editId) ? `
    <section class="panel panel-secondary">
      <header class="panel-header">
        <h3>${editId ? 'Editar usuario' : 'Nuevo usuario'}</h3>
        <button class="btn btn-sm" data-action="cerrar-usuario-form">✕</button>
      </header>
      <form id="formUsuario" class="form-grid">
        <label>Username<input name="username" required value="${editUser?.username || ''}" ${editId ? 'readonly' : ''} /></label>
        <label>Nombre<input name="nombre" required value="${editUser?.nombre || ''}" /></label>
        <label>Contraseña${editId ? ' (dejar vacío = sin cambio)' : ''}<input name="password" type="password" ${editId ? '' : 'required'} /></label>
        <label>Rol<select name="rol">${rolOptions}</select></label>
        <label>Sucursal<select name="sucursal_id">${sucOptions}</select></label>
        <input type="hidden" name="_editId" value="${editId || ''}" />
        <div class="actions full">
          <button class="btn primary" type="submit">${editId ? 'Guardar cambios' : 'Crear usuario'}</button>
        </div>
      </form>
    </section>` : '';

  return `<section class="panel">
    <header class="panel-header"><h3>Usuarios</h3><button class="btn primary" data-action="nuevo-usuario">+ Nuevo usuario</button></header>
    <div class="table-wrap">${table(['Username', 'Nombre', 'Rol', 'Sucursal', 'Estado', ''], []).replace('<tbody></tbody>', `<tbody>${rows}</tbody>`)}</div>
    ${formHtml}
  </section>`;
}

// ─── CUADRES ─────────────────────────────────────────────────────────────────

function panelCuadres() {
  const { selectedId } = viewState.cuadres;

  const rows = db.cierres_caja.map((c) => {
    const isSelected = c.id === selectedId;
    return `<tr class="clickable-row ${isSelected ? 'row-selected' : ''}" data-cuadre-id="${c.id}">
      <td>${c.id?.slice(0, 12) || '-'}...</td>
      <td>${fmtDate(c.fecha_hora || c.created_at)}</td>
      <td>${usuarioUsername(c.usuario_id)}</td>
      <td>${sucursalNombre(c.sucursal_id)}</td>
      <td>${money(c.total_general)}</td>
      <td class="${Number(c.diferencia) < 0 ? 'text-error' : ''}">${money(c.diferencia)}</td>
      <td><button class="btn btn-sm" data-action="ver-cuadre" data-id="${c.id}">Ver</button></td>
    </tr>`;
  }).join('');

  const detailHtml = selectedId ? panelCuadreDetalle(selectedId) : '';

  return `<section class="panel">
    <header class="panel-header"><h3>Cuadres registrados</h3></header>
    <div class="table-wrap">${table(['ID', 'Fecha/Hora', 'Usuario', 'Sucursal', 'Total', 'Diferencia', ''], []).replace('<tbody></tbody>', `<tbody>${rows}</tbody>`)}</div>
    ${detailHtml}
  </section>`;
}

function panelCuadreDetalle(cierreId) {
  const c = db.cierres_caja.find((x) => x.id === cierreId);
  if (!c) return '';
  return `<section class="panel panel-secondary">
    <header class="panel-header">
      <h3>Detalle cierre</h3>
      <button class="btn btn-sm" data-action="cerrar-cuadre-detalle">✕</button>
    </header>
    <div class="kpis">
      <article class="kpi"><p>Total general</p><h3>${money(c.total_general)}</h3></article>
      <article class="kpi"><p>Efectivo esperado</p><h3>${money(c.total_efectivo_esperado)}</h3></article>
      <article class="kpi"><p>Monto contado</p><h3>${money(c.monto_contado)}</h3></article>
      <article class="kpi"><p>Diferencia</p><h3 class="${Number(c.diferencia) < 0 ? 'text-error' : ''}">${money(c.diferencia)}</h3></article>
    </div>
    <div class="detail-grid">
      <div><b>ID:</b> ${c.id}</div>
      <div><b>Fecha:</b> ${fmtDate(c.fecha_hora || c.created_at)}</div>
      <div><b>Usuario:</b> ${usuarioUsername(c.usuario_id)}</div>
      <div><b>Sucursal:</b> ${sucursalNombre(c.sucursal_id)}</div>
      <div><b>Transferencia:</b> ${money(c.total_transferencia)}</div>
      <div><b>Tarjeta:</b> ${money(c.total_tarjeta)}</div>
      <div><b>Otros:</b> ${money(c.total_otros)}</div>
      <div><b>Observación:</b> ${c.observacion || '-'}</div>
    </div>
  </section>`;
}

// ─── AUDITORÍA ────────────────────────────────────────────────────────────────

function panelAuditoria() {
  const f = viewState.auditoria;
  let data = db.auditoria;

  if (f.usuario) data = data.filter((a) => (a.username || a.usuario || '').includes(f.usuario));
  if (f.modulo) data = data.filter((a) => a.modulo === f.modulo);
  if (f.accion) data = data.filter((a) => (a.accion || '').includes(f.accion));
  if (f.date_from) data = data.filter((a) => (a.fecha_hora || '') >= f.date_from);
  if (f.date_to) data = data.filter((a) => (a.fecha_hora || '') <= f.date_to + 'T23:59:59');

  const pageSize = 50;
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(f.page, totalPages);
  const slice = data.slice((page - 1) * pageSize, page * pageSize);

  const modulos = [...new Set(db.auditoria.map((a) => a.modulo).filter(Boolean))];
  const moduloOpts = ['', ...modulos].map((m) => `<option value="${m}" ${f.modulo === m ? 'selected' : ''}>${m || 'Todos'}</option>`).join('');

  const rows = slice.map((a) =>
    `<tr>
      <td>${fmtDate(a.fecha_hora)}</td>
      <td>${a.username || a.usuario || '-'}</td>
      <td>${a.modulo}</td>
      <td>${a.accion}</td>
      <td>${a.entidad}:${a.entidad_id || '-'}</td>
      <td>${a.resultado}</td>
    </tr>`,
  ).join('');

  const paginationHtml = totalPages > 1 ? `
    <div class="pagination">
      <button class="btn btn-sm" data-audit-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Anterior</button>
      <span>Pág ${page} / ${totalPages} (${total} eventos)</span>
      <button class="btn btn-sm" data-audit-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Siguiente →</button>
    </div>` : `<p class="hint">${total} eventos</p>`;

  return `<section class="panel">
    <header class="panel-header"><h3>Auditoría (inmutable)</h3></header>
    <form id="auditoriaFilters" class="filters-bar">
      <input name="usuario" placeholder="Usuario" value="${f.usuario}" />
      <select name="modulo">${moduloOpts}</select>
      <input name="accion" placeholder="Acción" value="${f.accion}" />
      <input name="date_from" type="date" value="${f.date_from}" />
      <input name="date_to" type="date" value="${f.date_to}" />
      <button class="btn primary" type="submit">Filtrar</button>
      <button class="btn" type="button" data-action="limpiar-auditoria">Limpiar</button>
    </form>
    <div class="table-wrap">${table(['Fecha/Hora', 'Usuario', 'Módulo', 'Acción', 'Entidad', 'Resultado'], []).replace('<tbody></tbody>', `<tbody>${rows}</tbody>`)}</div>
    ${paginationHtml}
  </section>`;
}

// ─── REPORTES ─────────────────────────────────────────────────────────────────

function panelReportes() {
  const r = buildReports();
  const bySucursalRows = r.bySucursal.map((x) => [x.sucursal, x.paquetes]);
  const byEstadoRows = r.byEstado.map((x) => [badge(x.estado), x.cantidad]);
  const ingresosRows = r.ingresos.map((x) => [x.sucursal, money(x.ingresos)]);
  const frecuentesRows = r.frecuentes.map((x) => [x.cliente, x.envios]);
  const rutasRows = r.tiemposRuta.map((x) => [x.ruta, x.muestras, x.promedio_min, x.estado]);

  return `<section class="panel">
    <header class="panel-header">
      <h3>Reportes y analítica</h3>
      <button class="btn primary" data-action="exportar-csv">⬇ Exportar CSV</button>
    </header>
    <div class="kpis">
      <article class="kpi"><p>Paquetes registrados</p><h3>${db.paquetes.length}</h3></article>
      <article class="kpi"><p>Clientes</p><h3>${db.clientes.length}</h3></article>
      <article class="kpi"><p>Ventas totales</p><h3>${money(db.ventas.reduce((a, b) => a + Number(b.monto || 0), 0))}</h3></article>
      <article class="kpi"><p>Cierres</p><h3>${db.cierres_caja.length}</h3></article>
    </div>

    <h4>Paquetes por sucursal</h4>
    <div class="table-wrap">${table(['Sucursal', 'Paquetes'], bySucursalRows)}</div>

    <h4>Por estado</h4>
    <div class="table-wrap">${table(['Estado', 'Cantidad'], byEstadoRows)}</div>

    <h4>Ingresos por sucursal</h4>
    <div class="table-wrap">${table(['Sucursal', 'Ingresos'], ingresosRows)}</div>

    <h4>Clientes frecuentes (top 5)</h4>
    <div class="table-wrap">${table(['Cliente', 'Envíos'], frecuentesRows)}</div>

    <h4>Tiempos de ruta</h4>
    <div class="table-wrap">${table(['Ruta', 'Muestras', 'Promedio (min)', 'Estado'], rutasRows)}</div>
  </section>`;
}

// ─── FACTURACIÓN ELECTRÓNICA ──────────────────────────────────────────────────

function panelFiscal(readOnly) {
  const cfg = db.configuracion_fiscal || {};
  const docs = db.documentos_fiscales || [];

  const docsRows = docs.map((d) =>
    `<tr>
      <td>${d.id?.slice(0, 12) || '-'}...</td>
      <td>${badge(d.estado)}</td>
      <td>${d.venta_id || '-'}</td>
      <td>${d.track_id || '-'}</td>
      <td>
        <button class="btn btn-sm" data-action="fiscal-xml" data-docid="${d.id}">XML</button>
        <button class="btn btn-sm" data-action="fiscal-sign" data-docid="${d.id}">Firmar</button>
        <button class="btn btn-sm" data-action="fiscal-send" data-docid="${d.id}">Enviar</button>
      </td>
    </tr>`,
  ).join('');

  const configForm = !readOnly ? `
    <section class="panel panel-secondary">
      <header class="panel-header"><h3>Configuración fiscal</h3></header>
      <form id="formFiscalConfig" class="form-grid">
        <label>RNC<input name="rnc" value="${cfg.rnc || ''}" required /></label>
        <label>Razón social<input name="razon_social" value="${cfg.razon_social || ''}" required /></label>
        <label>Ambiente
          <select name="ambiente">
            <option value="CERTIFICACION" ${cfg.ambiente === 'CERTIFICACION' ? 'selected' : ''}>CERTIFICACIÓN</option>
            <option value="PRODUCCION" ${cfg.ambiente === 'PRODUCCION' ? 'selected' : ''}>PRODUCCIÓN</option>
          </select>
        </label>
        <div class="actions full">
          <button class="btn primary" type="submit">Guardar configuración</button>
          <button class="btn" type="button" data-action="fiscal-status">Verificar estado</button>
        </div>
      </form>
      <div id="fiscalFeedback" class="hint"></div>
    </section>` : '';

  return `<section class="panel">
    <header class="panel-header"><h3>Facturación electrónica (modo preparación)</h3></header>
    <div class="notice warning">MODO PREPARACIÓN: integración DGII desacoplada, lista para conectar. Estado: <b>${cfg.estado_configuracion || 'incompleta'}</b></div>
    <div class="detail-grid">
      <div><span>RNC</span><span>${cfg.rnc || 'No configurado'}</span></div>
      <div><span>Razón social</span><span>${cfg.razon_social || 'No configurada'}</span></div>
      <div><span>Ambiente</span><span>${cfg.ambiente || 'PREPARACION'}</span></div>
    </div>
    ${configForm}
    <h4>Documentos fiscales</h4>
    <div class="table-wrap">${docs.length
      ? table(['ID', 'Estado', 'Venta', 'TrackId', 'Acciones'], []).replace('<tbody></tbody>', `<tbody>${docsRows}</tbody>`)
      : '<p class="hint">No hay documentos fiscales generados aún.</p>'
    }</div>
  </section>`;
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

function panelConfiguracion() {
  const cfg = db.configuracion_fiscal || {};
  return `<section class="panel">
    <header class="panel-header"><h3>Configuración general</h3></header>
    <form id="formConfigGeneral" class="form-grid">
      <label>Nombre de la empresa<input name="nombre_empresa" value="${cfg.nombre_comercial || ''}" required /></label>
      <label>RNC<input name="rnc_empresa" value="${cfg.rnc || ''}" /></label>
      <label>Dirección<input name="direccion_empresa" value="${cfg.direccion_fiscal || ''}" /></label>
      <label>Correo<input name="correo_empresa" type="email" value="${cfg.correo_fiscal || ''}" /></label>
      <div class="actions full">
        <button class="btn primary" type="submit">Guardar configuración</button>
      </div>
    </form>
    <div id="configFeedback" class="hint"></div>

    <section class="panel panel-secondary" style="margin-top:1rem">
      <header class="panel-header"><h3>Estado del sistema</h3></header>
      <div class="detail-grid">
        <div><span>Usuarios registrados</span><span>${db.usuarios.length}</span></div>
        <div><span>Sucursales</span><span>${db.sucursales.length}</span></div>
        <div><span>Paquetes en sistema</span><span>${db.paquetes.length}</span></div>
        <div><span>Configuración fiscal</span><span>${cfg.estado_configuracion || 'incompleta'}</span></div>
        <div><span>Ambiente fiscal</span><span>${cfg.ambiente || 'PREPARACION'}</span></div>
        <div><span>Clientes registrados</span><span>${db.clientes.length}</span></div>
      </div>
    </section>
  </section>`;
}

// ─── IMPRESORAS ───────────────────────────────────────────────────────────────

function panelImpresoras() {
  const qz = qzState();
  const cfg = getPrinterConfig();

  const printerList = (qz.printers || []).length > 0
    ? `<p style="font-size:.83rem;color:var(--gray-600);margin:.3rem 0 0">Impresoras detectadas: <b>${(qz.printers || []).join(', ')}</b></p>`
    : '';

  return `<section class="panel">
    <header class="panel-header">
      <h3>Configuración de impresoras (QZ Tray)</h3>
      <span class="badge ${qz.connected ? 'disponible' : 'incidencia'}">${qz.connected ? '● Conectado' : '○ Desconectado'}</span>
    </header>

    <div class="notice warning" style="margin-bottom:.85rem">
      <b>⚠️ Requisito importante:</b> QZ Tray solo funciona cuando la impresora está conectada al <b>mismo computador</b> desde donde se abre esta aplicación en el navegador (Windows, Mac o Linux).<br>
      <span style="font-size:.82rem;color:var(--warning-text)">No funciona desde tabletas (iPad/Android) ni desde dispositivos móviles. Para imprimir, use Chrome o Edge en el computador de la sucursal.</span>
    </div>

    <div class="notice ${qz.connected ? 'success' : 'error'}" style="margin-bottom:.85rem">
      Estado: <b>${qz.connected ? '✓ QZ Tray conectado' : '✗ QZ Tray no conectado'}</b>
      ${qz.connected ? ` — ${(qz.printers || []).length} impresora(s) disponible(s)` : ''}
    </div>
    ${printerList ? `<div style="margin-bottom:.85rem">${printerList}</div>` : ''}

    <div class="actions" style="margin-bottom:1rem">
      <button class="btn primary" data-action="connect-qz" type="button">${qz.connected ? '🔄 Reconectar QZ' : '🔌 Conectar QZ Tray'}</button>
      ${qz.connected ? `<button class="btn" data-action="disconnect-qz" type="button">Desconectar</button>` : ''}
    </div>

    <form id="printerForm" class="form-grid">
      <label>Impresora térmica (ticket de caja)<select name="termica" id="printerTermica"><option value="">— Seleccione —</option></select></label>
      <label>Impresora adhesiva (etiqueta de envío)<select name="adhesiva" id="printerAdhesiva"><option value="">— Seleccione —</option></select></label>
      <div class="actions full">
        <button class="btn primary" data-action="save-printers" type="button" ${!qz.connected ? 'disabled' : ''}>💾 Guardar</button>
        <button class="btn" data-action="test-termica" type="button" ${!qz.connected ? 'disabled' : ''}>🖨️ Probar térmica</button>
        <button class="btn" data-action="test-adhesiva" type="button" ${!qz.connected ? 'disabled' : ''}>🏷️ Probar etiqueta</button>
      </div>
    </form>

    <div class="notice" style="margin-top:.85rem">
      Guardado: térmica=<b>${cfg.termica || 'ninguna'}</b> | adhesiva=<b>${cfg.adhesiva || 'ninguna'}</b>
    </div>
    <div id="printFeedback" class="hint" style="margin-top:.5rem"></div>

    <details style="margin-top:.85rem" open>
      <summary style="font-weight:600;cursor:pointer">📋 Configuración permanente (una sola vez por computador)</summary>
      <div style="padding:.7rem 0;font-size:.84rem;color:var(--gray-700);display:grid;gap:.65rem">

        <div class="notice warning">
          <b>¿QZ Tray sigue pidiendo permiso en cada recarga?</b><br>
          Esto se soluciona agregando el certificado de esta app en el <b>Site Manager de QZ Tray</b>. Solo se hace una vez por computador. Después nunca vuelve a preguntar.
        </div>

        <div class="notice">
          <b>Paso 1</b> — Descargue el certificado de esta app:<br>
          <a href="/api/impresion/qz/cert/download" download="astrapu-qztray.crt" class="btn" style="display:inline-block;margin-top:.4rem;font-size:.82rem">⬇️ Descargar certificado astrapu-qztray.crt</a>
        </div>

        <div class="notice">
          <b>Paso 2</b> — Abra QZ Tray → haga clic derecho en el ícono de la barra de tareas → <b>"Site Manager"</b>
        </div>

        <div class="notice">
          <b>Paso 3</b> — En Site Manager, haga clic en <b>"Add"</b> → seleccione el archivo <b>astrapu-qztray.crt</b> que descargó → confirme.<br>
          <span style="font-size:.8rem;color:var(--gray-500)">Si QZ Tray pide una URL, escriba el dominio de esta app (ejemplo: <code>astrapu.replit.app</code>)</span>
        </div>

        <div class="notice">
          <b>Paso 4</b> — Haga clic en <b>"🔌 Conectar QZ Tray"</b> arriba. A partir de ahora conecta automáticamente sin ningún diálogo.
        </div>

        <div style="border-top:1px solid var(--gray-200);padding-top:.55rem;color:var(--gray-500);font-size:.8rem">
          QZ Tray debe estar abierto en el mismo computador donde está conectada la impresora.<br>
          Descarga QZ Tray: <a href="https://qz.io/download/" target="_blank" style="color:var(--brand-500)">qz.io/download</a> (versión mínima 2.1)
        </div>
      </div>
    </details>
  </section>`;
}

// ─── NUEVO ENVÍO ──────────────────────────────────────────────────────────────

function panelNuevoEnvio(readOnly) {
  const options = db.sucursales.map((s) => `<option value="${s.id}">${s.nombre}</option>`).join('');
  return `
    <section class="panel">
      <header class="panel-header"><h3>Registro de envío</h3></header>
      <form id="formEnvio" class="form-grid">
        <label>Teléfono del cliente<input name="telefono" required placeholder="8095550000" /></label>
        <label>Nombre del cliente<input name="nombre" required /></label>
        <label>Cédula<input name="cedula" placeholder="Opcional" /></label>
        <label>Dirección<input name="direccion" placeholder="Opcional" /></label>
        <label>Descripción del artículo<input name="descripcion" required /></label>
        <label>Color del empaque<input name="color_empaque" required /></label>
        <label>Monto a cobrar<input name="monto" type="number" min="0" step="0.01" required /></label>
        <label>Método de pago
          <select name="metodo_pago">
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="TARJETA">Tarjeta</option>
            <option value="OTRO">Otro</option>
          </select>
        </label>
        <label>Sucursal origen<select name="sucursal_origen">${options}</select></label>
        <label>Sucursal destino<select name="sucursal_destino">${options}</select></label>
        <label class="full">Observación<textarea name="observacion" rows="2"></textarea></label>
        <div class="full actions">
          <button ${readOnly ? 'disabled' : ''} class="btn primary" type="submit">Registrar envío</button>
          <button ${readOnly ? 'disabled' : ''} class="btn" type="button" data-action="reimprimir-ultimo">Reimprimir último</button>
        </div>
      </form>
      <div id="autocompleteCliente" class="hint">Escriba teléfono para autocompletar cliente.</div>
      <div id="previewEnvio" class="preview"></div>
    </section>`;
}

// ─── ESCANEO ──────────────────────────────────────────────────────────────────

function panelEscaneo(mode) {
  const isEnviar = mode === 'enviar';
  const status = isEnviar ? 'PENDIENTE' : 'EN_TRANSITO';

  let pendientesPanel = '';
  if (isEnviar) {
    const pendientes = db.paquetes.filter((p) => p.estado === 'PENDIENTE');
    const rows = pendientes.map((p) => {
      const clienteNom = p.cliente_nombre || db.clientes.find((c) => c.id === p.cliente_id)?.nombre || '-';
      const origen = db.sucursales.find((s) => s.id === p.sucursal_origen)?.nombre || '-';
      const destino = db.sucursales.find((s) => s.id === p.sucursal_destino)?.nombre || '-';
      const fecha = fmtDate(p.created_at);
      return `<tr>
        <td><b>${p.guia}</b></td>
        <td>${clienteNom}</td>
        <td>${p.descripcion || '-'}</td>
        <td>${origen}</td>
        <td>${destino}</td>
        <td>${money(p.monto)}</td>
        <td>${fecha}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm" data-action="scan-guia" data-guia="${p.guia}" title="Escanear este paquete para enviarlo">📤 Escanear</button>
          <button class="btn btn-sm" data-action="reimprimir-paquete" data-id="${p.id}" title="Reimprimir ticket y etiqueta">🖨️ Reimprimir</button>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" style="text-align:center;color:var(--gray-400)">No hay paquetes pendientes de envío</td></tr>`;

    pendientesPanel = `
    <section class="panel" style="margin-top:0">
      <header class="panel-header">
        <h3>Pendientes por enviar <span style="background:var(--brand-100);color:var(--brand-700);font-size:.78rem;font-weight:700;padding:.18rem .55rem;border-radius:999px;margin-left:.4rem">${pendientes.length}</span></h3>
      </header>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Guía</th><th>Cliente</th><th>Descripción</th><th>Origen</th><th>Destino</th><th>Monto</th><th>Fecha</th><th>Acciones</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
  }

  return `<section class="panel">
    <header class="panel-header"><h3>${VIEW_LABELS[isEnviar ? 'enviar_paquetes' : 'recibir_paquetes']}</h3></header>
    <div class="scan-zone">
      <h2>${isEnviar ? 'Modo escaneo de salida' : 'Modo recepción'}</h2>
      <input id="scanInput" data-mode="${mode}" placeholder="Escanee o escriba guía/código de barras" autofocus />
      <p class="hint">Validación esperada: estado <b>${status}</b></p>
      <div id="scanFeedback" class="hint"></div>
    </div>
    <div class="table-wrap" id="scanTable" style="margin-top:.7rem"></div>
  </section>
  ${pendientesPanel}`;
}

// ─── BUSCAR PAQUETE ───────────────────────────────────────────────────────────

function panelBuscar() {
  return `<section class="panel">
    <header class="panel-header"><h3>Buscar paquete</h3></header>
    <div class="filters-bar">
      <input id="buscarTelefono" placeholder="Teléfono del destinatario (ej: 8095550000)" />
    </div>
    <div id="resultadoBusqueda" class="result-cards"></div>
  </section>`;
}

// ─── ENTREGAR PAQUETE ─────────────────────────────────────────────────────────

function panelEntregar() {
  return `<section class="panel">
    <header class="panel-header"><h3>Entrega con doble validación</h3></header>
    <div class="steps">
      <span class="active">1 Buscar</span>
      <span>2 Cédula</span>
      <span>3 Escaneo final</span>
      <span>4 Confirmar</span>
    </div>
    <div id="entregaSeleccion" class="preview">Seleccione un paquete desde <b>Buscar paquete</b>.</div>
    <label>Cédula del destinatario<input id="cedulaEntrega" placeholder="001-0000000-0" /></label>
    <label>Escaneo final (guía o código de barras)<input id="scanEntrega" placeholder="Escanee la etiqueta" /></label>
    <button class="btn primary" id="confirmarEntregaBtn">Confirmar entrega</button>
    <div id="entregaFeedback" class="hint"></div>
  </section>`;
}

// ─── PAQUETES ENTREGADOS ──────────────────────────────────────────────────────

function panelEntregados() {
  const entregados = db.paquetes.filter((p) => p.estado === PACKAGE_STATUS.ENTREGADO);
  const rows = entregados.map((p) =>
    `<tr>
      <td>${p.guia}</td>
      <td>${p.cliente_nombre || clienteNombre(p.cliente_id)}</td>
      <td>${p.telefono_destinatario}</td>
      <td>${fmtDate(p.entregado_at)}</td>
      <td>${usuarioUsername(p.created_by || p.usuario_id)}</td>
      <td>${sucursalNombre(p.sucursal_destino)}</td>
    </tr>`,
  ).join('');
  return `<section class="panel">
    <header class="panel-header"><h3>Paquetes entregados</h3></header>
    <div class="table-wrap">${table(['Guía', 'Cliente', 'Teléfono', 'Entregado', 'Usuario', 'Sucursal'], []).replace('<tbody></tbody>', `<tbody>${rows || '<tr><td colspan="6">Sin paquetes entregados aún</td></tr>'}</tbody>`)}</div>
  </section>`;
}

// ─── VENTAS ───────────────────────────────────────────────────────────────────

function panelVentas() {
  const rows = db.ventas.map((v) =>
    `<tr>
      <td>${v.guia}</td>
      <td>${v.cliente_nombre || v.cliente || '-'}</td>
      <td>${money(v.monto)}</td>
      <td>${v.metodo_pago}</td>
      <td>${fmtDate(v.fecha_hora || v.created_at)}</td>
      <td>${v.cierre_id ? '<span class="badge disponible">Sí</span>' : '<span class="badge pendiente">No</span>'}</td>
    </tr>`,
  ).join('');
  return `<section class="panel">
    <header class="panel-header"><h3>Ventas</h3></header>
    <div class="table-wrap">${table(['Guía', 'Cliente', 'Monto', 'Método', 'Fecha/Hora', 'En cierre'], []).replace('<tbody></tbody>', `<tbody>${rows || '<tr><td colspan="6">Sin ventas registradas</td></tr>'}</tbody>`)}</div>
    <div class="actions">
      <button class="btn" data-view="cierre_caja" data-action="hacer-cierre">Hacer cierre de caja</button>
    </div>
  </section>`;
}

// ─── CIERRE DE CAJA ───────────────────────────────────────────────────────────

function panelCierre(readOnly) {
  const r = resumenPendientes();
  return `<section class="panel">
    <header class="panel-header"><h3>Cierre de caja</h3></header>
    <div class="kpis">
      <article class="kpi"><p>Ventas pendientes</p><h3>${r.cantidad}</h3></article>
      <article class="kpi"><p>Total general</p><h3>${money(r.total)}</h3></article>
      <article class="kpi"><p>Efectivo esperado</p><h3>${money(r.efectivo)}</h3></article>
      <article class="kpi"><p>Transferencia/Tarjeta/Otros</p><h3>${money(r.transferencia + r.tarjeta + r.otros)}</h3></article>
    </div>
    <form id="formCierre" class="form-grid">
      <label>Monto contado (efectivo real)<input name="monto_contado" type="number" min="0" step="0.01" required /></label>
      <label class="full">Observación<textarea name="observacion" rows="2"></textarea></label>
      <div class="full actions">
        <button ${readOnly ? 'disabled' : ''} class="btn primary" data-action="confirmar-cierre">Confirmar cierre</button>
      </div>
    </form>
  </section>`;
}

// ─── MI HISTORIAL ─────────────────────────────────────────────────────────────

function panelMiHistorial(userId) {
  const items = db.auditoria.filter((a) => {
    const u = db.usuarios.find((u) => u.username === (a.username || a.usuario));
    return u?.id === userId || a.usuario_id === userId;
  });
  return `<section class="panel">
    <header class="panel-header"><h3>Mi historial de actividad</h3></header>
    <div class="table-wrap">${table(['Fecha/Hora', 'Acción', 'Módulo', 'Entidad', 'Resultado'], items.slice(0, 100).map((x) => [
      fmtDate(x.fecha_hora),
      x.accion,
      x.modulo,
      `${x.entidad}:${x.entidad_id || '-'}`,
      x.resultado,
    ]))}</div>
  </section>`;
}

// ─── PERFIL ───────────────────────────────────────────────────────────────────

function panelPerfil(user) {
  const totalAcciones = db.auditoria.filter((a) => (a.username === user.username || a.usuario_id === user.id)).length;
  const totalEnvios = db.paquetes.filter((p) => p.created_by === user.id || p.usuario_id === user.id).length;
  return `<section class="panel">
    <header class="panel-header"><h3>Mi perfil</h3></header>
    <div class="detail-grid">
      <div><b>Nombre:</b> ${user.nombre}</div>
      <div><b>Usuario:</b> ${user.username}</div>
      <div><b>Rol:</b> ${user.rol.toUpperCase()}</div>
      <div><b>Sucursal:</b> ${sucursalNombre(user.sucursal_id)}</div>
      <div><b>Acciones registradas:</b> ${totalAcciones}</div>
      <div><b>Envíos realizados:</b> ${totalEnvios}</div>
    </div>
  </section>`;
}
