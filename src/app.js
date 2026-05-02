import { MENUS, VIEW_LABELS } from './constants.js';
import { db } from './data/store.js';
import { loginAs, logout, getCurrentUser, getRoleMenu, canEdit, getStoredUser, isLoggedIn, isSuperAdmin, setSimulatedRole, getSimulatedRole } from './services/authService.js';
import { logAudit } from './services/auditService.js';
import { connectQZ, disconnectQZ, getPrinters, setPrinterConfig, getPrinterConfig, printThermalTicket, printAdhesiveLabel } from './services/qzService.js';
import { printSaleDocuments } from './services/printService.js';
import { renderView, menuButton, viewState } from './views.js';
import { api } from './services/apiClient.js';

const refs = {
  title: document.getElementById('viewTitle'),
  subtitle: document.getElementById('viewSubtitle'),
  menu: document.getElementById('sideMenu'),
  user: document.getElementById('sessionUser'),
  roleLabel: document.getElementById('sessionRole'),
  branch: document.getElementById('sessionBranch'),
  content: document.getElementById('appContent'),
  alert: document.getElementById('globalAlert'),
};

const defaultViewByRole = {
  admin: 'dashboard',
  envios: 'nuevo_envio',
  entrega: 'recibir_paquetes',
  contable: 'dashboard_contable',
};

let currentView = defaultViewByRole[getCurrentUser()?.rol] || 'dashboard';
let scanTimer;
let selectedDeliveryPackage = null;
let selectedDeliverySession = null;

async function syncDataFromBackend() {
  try {
    const role = getCurrentUser().rol;
    const canSeeAudit = role === 'admin' || role === 'contable';

    const auditUrl = canSeeAudit ? '/api/auditoria?page=1&page_size=200' : '/api/ops/mi-auditoria';

    const [ventasRes, paquetesRes, cierresRes, sucursalesRes, clientesRes, usuariosRes, auditRes] = await Promise.all([
      api('/api/ops/ventas'),
      api('/api/ops/paquetes'),
      api('/api/ops/cierres'),
      api('/api/ops/sucursales'),
      api('/api/ops/clientes'),
      api('/api/ops/usuarios'),
      api(auditUrl),
    ]);

    db.ventas = ventasRes.data || [];
    db.paquetes = paquetesRes.data || [];
    db.cierres_caja = cierresRes.data || [];
    db.sucursales = sucursalesRes.data || db.sucursales;
    db.clientes = clientesRes.data || db.clientes;
    db.usuarios = usuariosRes.data || db.usuarios;
    db.auditoria = auditRes.data || [];

    if (canSeeAudit) {
      const fiscalStatusRes = await api('/api/fiscal/status').catch(() => null);
      if (fiscalStatusRes?.data?.configuracion) {
        db.configuracion_fiscal = { ...db.configuracion_fiscal, ...fiscalStatusRes.data.configuracion };
      }
    }

    const printerCfgRes = await api('/api/print/config').catch(() => null);
    if (printerCfgRes?.data) {
      const srv = printerCfgRes.data;
      db.configuracion_impresoras.termica        = srv.impresora_termica   || db.configuracion_impresoras.termica;
      db.configuracion_impresoras.adhesiva       = srv.impresora_adhesiva  || db.configuracion_impresoras.adhesiva;
      db.configuracion_impresoras.nombre_empresa = srv.nombre_empresa      || db.configuracion_impresoras.nombre_empresa;
      db.configuracion_impresoras.subtitulo      = srv.subtitulo           || db.configuracion_impresoras.subtitulo;
      db.configuracion_impresoras.telefono       = srv.telefono_empresa    || db.configuracion_impresoras.telefono;
      db.configuracion_impresoras.rnc            = srv.rnc                 || db.configuracion_impresoras.rnc;
      db.configuracion_impresoras.mensaje_final  = srv.mensaje_final       || db.configuracion_impresoras.mensaje_final;
      if (srv.adhesiva_tipo) db.configuracion_impresoras.adhesiva_tipo = srv.adhesiva_tipo;
    }
  } catch (error) {
    showAlert(`Error de sincronización: ${error.message}`, 'error');
  }
}

function showAlert(msg, type = 'info') {
  refs.alert.className = `global-alert ${type}`;
  refs.alert.textContent = msg;
}

function renderMenu() {
  refs.menu.innerHTML = getRoleMenu().map((v) => menuButton(v, currentView === v)).join('');
  refs.menu.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    currentView = b.dataset.view;
    viewState.paquetes.selectedId = null;
    viewState.cuadres.selectedId = null;
    render();
  }));
}

function renderSession() {
  const user = getCurrentUser();
  if (!user) return;
  const branchName = db.sucursales.find((s) => s.id === user.sucursal_id)?.nombre || '-';
  const simulating = !!getSimulatedRole();
  const roleLabel = simulating ? `${user.rol.toUpperCase()} (simulado)` : user.rol.toUpperCase();
  refs.user.textContent = user.nombre;
  refs.roleLabel.textContent = roleLabel;
  refs.branch.textContent = branchName;
  refs.subtitle.textContent = `${user.nombre} · ${roleLabel} · ${branchName}`;

  // Sidebar user card
  const avatarEl = document.getElementById('sidebarAvatar');
  const nameEl   = document.getElementById('sidebarUserName');
  const roleEl   = document.getElementById('sidebarUserRole');
  const branchEl = document.getElementById('sidebarUserBranch');
  if (avatarEl) avatarEl.textContent = (user.nombre || user.username || '?')[0].toUpperCase();
  if (nameEl)   nameEl.textContent   = user.nombre || user.username;
  if (roleEl)   roleEl.textContent   = roleLabel;
  if (branchEl) branchEl.textContent = branchName;

  // Super admin role switcher visibility + value
  const sw = document.getElementById('superAdminSwitch');
  const sel = document.getElementById('superRoleSelect');
  if (sw && sel) {
    if (isSuperAdmin()) {
      sw.style.display = '';
      sel.value = user.rol;
    } else {
      sw.style.display = 'none';
    }
  }
}

async function render() {
  const role = getCurrentUser().rol;
  if (!MENUS[role].includes(currentView)) currentView = defaultViewByRole[role];

  await syncDataFromBackend();

  refs.title.textContent = VIEW_LABELS[currentView] || currentView;
  refs.content.innerHTML = renderView(currentView);

  renderMenu();
  renderSession();
  wireViewInteractions();
  if (!canEdit()) enforceReadonly();
}

function enforceReadonly() {
  refs.content.querySelectorAll('input,select,textarea,button').forEach((el) => {
    if (!el.dataset.allowReadonly) el.disabled = true;
  });
}

// ─── WIRING CENTRAL ──────────────────────────────────────────────────────────

function wireViewInteractions() {
  wireEnvioForm();
  wireScanning();
  wireBusqueda();
  wireEntrega();
  wireCierre();
  wirePrinters();
  wireDashboardLinks();
  wirePaquetesPanel();
  wireClientesPanel();
  wireSucursalesPanel();
  wireUsuariosPanel();
  wireAuditoriaFiltros();
  wireCuadresPanel();
  wireFiscalPanel();
  wireConfiguracion();
  wireVentasPanel();
  wireReportesPanel();
  wireInteligencia();
}

// ─── REPORTES ─────────────────────────────────────────────────────────────────

function wireReportesPanel() {
  refs.content.querySelector('[data-action="exportar-csv"]')?.addEventListener('click', () => {
    const ahora = new Date().toISOString().slice(0, 10);
    const filename = `astrapu-reporte-${ahora}.csv`;

    const sections = [];

    sections.push('=== PAQUETES ===');
    sections.push(['Guía', 'Cliente', 'Estado', 'Origen', 'Destino', 'Monto', 'Fecha'].join(','));
    db.paquetes.forEach((p) => {
      const origen = db.sucursales.find((s) => s.id === p.sucursal_origen)?.nombre || p.sucursal_origen;
      const destino = db.sucursales.find((s) => s.id === p.sucursal_destino)?.nombre || p.sucursal_destino;
      const cliente = db.clientes.find((c) => c.id === p.cliente_id)?.nombre || p.cliente_nombre || '-';
      sections.push([p.guia, `"${cliente}"`, p.estado, `"${origen}"`, `"${destino}"`, p.monto || '0', String(p.created_at || '').slice(0, 16)].join(','));
    });

    sections.push('');
    sections.push('=== VENTAS ===');
    sections.push(['Guía', 'Cliente', 'Monto', 'Método', 'Fecha', 'En cierre'].join(','));
    db.ventas.forEach((v) => {
      sections.push([v.guia, `"${v.cliente_nombre || v.cliente || '-'}"`, v.monto || '0', v.metodo_pago, String(v.fecha_hora || v.created_at || '').slice(0, 16), v.cierre_id ? 'Sí' : 'No'].join(','));
    });

    sections.push('');
    sections.push('=== CLIENTES ===');
    sections.push(['Nombre', 'Teléfono', 'Cédula', 'Email'].join(','));
    db.clientes.forEach((c) => {
      sections.push([`"${c.nombre}"`, c.telefono || '-', c.cedula || '-', c.email || '-'].join(','));
    });

    sections.push('');
    sections.push('=== CIERRES DE CAJA ===');
    sections.push(['ID', 'Usuario', 'Total', 'Fecha'].join(','));
    db.cierres_caja.forEach((cc) => {
      const usr = db.usuarios.find((u) => u.id === cc.usuario_id)?.username || '-';
      sections.push([cc.id, usr, cc.total_monto || '0', String(cc.created_at || '').slice(0, 16)].join(','));
    });

    const blob = new Blob([sections.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showAlert(`Reporte exportado: ${filename}`, 'success');
  });
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

function wireDashboardLinks() {
  refs.content.querySelectorAll('.kpi.clickable').forEach((kpi) => {
    kpi.addEventListener('click', () => {
      const estado = kpi.dataset.filterEstado;
      const nav = kpi.dataset.nav;
      if (nav) {
        viewState.paquetes.estado = estado || '';
        viewState.paquetes.search = '';
        currentView = nav;
        render();
      }
    });
  });

  refs.content.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentView = btn.dataset.view;
      render();
    });
  });
}

// ─── PAQUETES ─────────────────────────────────────────────────────────────────

function wirePaquetesPanel() {
  const searchInput = document.getElementById('paqueteSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      viewState.paquetes.search = searchInput.value;
      const rows = filterPaquetesRows();
      rebuildPaquetesBody(rows);
    });
  }

  refs.content.querySelectorAll('[data-filter-estado]').forEach((btn) => {
    if (!btn.dataset.nav) {
      btn.addEventListener('click', () => {
        viewState.paquetes.estado = btn.dataset.filterEstado;
        render();
      });
    }
  });

  refs.content.querySelectorAll('[data-paquete-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.paqueteId;
      viewState.paquetes.selectedId = viewState.paquetes.selectedId === id ? null : id;
      if (viewState.paquetes.selectedId) {
        loadPaqueteMovimientos(id);
      } else {
        render();
      }
    });
  });

  refs.content.querySelector('[data-action="cerrar-detalle-paquete"]')?.addEventListener('click', () => {
    viewState.paquetes.selectedId = null;
    render();
  });
}

function filterPaquetesRows() {
  const { search, estado } = viewState.paquetes;
  return db.paquetes.filter((p) => {
    const matchEstado = !estado || p.estado === estado;
    const q = search.toLowerCase();
    const matchSearch = !search ||
      p.guia.toLowerCase().includes(q) ||
      (p.cliente_nombre || '').toLowerCase().includes(q) ||
      (p.telefono_destinatario || '').includes(q);
    return matchEstado && matchSearch;
  });
}

function rebuildPaquetesBody(rows) {
  const tbody = refs.content.querySelector('table tbody');
  if (!tbody) return;
  const badge = (s) => `<span class="badge ${(s || '').toLowerCase()}">${(s || '').replace('_', ' ')}</span>`;
  const fmtDate = (d) => (d ? String(d).slice(0, 16).replace('T', ' ') : '-');
  const sucursalNombre = (id) => db.sucursales.find((s) => s.id === id)?.nombre || '-';
  const clienteNombre = (id) => db.clientes.find((c) => c.id === id)?.nombre || '-';
  tbody.innerHTML = rows.slice(0, 200).map((p) =>
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

  tbody.querySelectorAll('[data-paquete-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.paqueteId;
      viewState.paquetes.selectedId = viewState.paquetes.selectedId === id ? null : id;
      if (viewState.paquetes.selectedId) loadPaqueteMovimientos(id);
      else render();
    });
  });
}

async function loadPaqueteMovimientos(paqueteId) {
  try {
    const res = await api(`/api/ops/paquetes/${paqueteId}/movimientos`);
    db.movimientos_paquete = [
      ...db.movimientos_paquete.filter((m) => m.paquete_id !== paqueteId),
      ...(res.data || []),
    ];
  } catch (_) {}
  render();
}

// ─── CLIENTES ─────────────────────────────────────────────────────────────────

function wireClientesPanel() {
  const searchInput = document.getElementById('clienteSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      viewState.clientes.search = searchInput.value;
      render();
    });
  }

  refs.content.querySelector('[data-action="nuevo-cliente"]')?.addEventListener('click', () => {
    viewState.clientes.showForm = true;
    viewState.clientes.editId = null;
    render();
  });

  refs.content.querySelector('[data-action="cerrar-cliente-form"]')?.addEventListener('click', () => {
    viewState.clientes.showForm = false;
    viewState.clientes.editId = null;
    render();
  });

  refs.content.querySelectorAll('[data-action="editar-cliente"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewState.clientes.editId = btn.dataset.id;
      viewState.clientes.showForm = false;
      render();
    });
  });

  const formCliente = document.getElementById('formCliente');
  if (formCliente) {
    formCliente.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formCliente);
      const data = Object.fromEntries(fd.entries());
      const editId = data._editId;
      delete data._editId;

      try {
        if (editId) {
          await api(`/api/admin/clientes/${editId}`, { method: 'PUT', body: data });
          showAlert('Cliente actualizado correctamente.', 'success');
        } else {
          await api('/api/admin/clientes', { method: 'POST', body: data });
          showAlert('Cliente registrado correctamente.', 'success');
        }
        viewState.clientes.showForm = false;
        viewState.clientes.editId = null;
        render();
      } catch (error) {
        showAlert(error.message, 'error');
      }
    });
  }
}

// ─── SUCURSALES ───────────────────────────────────────────────────────────────

function wireSucursalesPanel() {
  refs.content.querySelector('[data-action="nueva-sucursal"]')?.addEventListener('click', () => {
    viewState.sucursales.showForm = true;
    viewState.sucursales.editId = null;
    render();
  });

  refs.content.querySelector('[data-action="cerrar-sucursal-form"]')?.addEventListener('click', () => {
    viewState.sucursales.showForm = false;
    viewState.sucursales.editId = null;
    render();
  });

  refs.content.querySelectorAll('[data-action="editar-sucursal"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewState.sucursales.editId = btn.dataset.id;
      viewState.sucursales.showForm = false;
      render();
    });
  });

  refs.content.querySelectorAll('[data-action="eliminar-sucursal"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nombre = btn.dataset.nombre || btn.dataset.id;
      if (!confirm(`¿Eliminar la sucursal "${nombre}"? Esta acción no se puede deshacer.`)) return;
      try {
        await api(`/api/admin/sucursales/${btn.dataset.id}`, { method: 'DELETE' });
        showAlert('Sucursal eliminada.', 'success');
        render();
      } catch (error) {
        showAlert(error.message, 'error');
      }
    });
  });

  const formSuc = document.getElementById('formSucursal');
  if (formSuc) {
    formSuc.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formSuc);
      const data = Object.fromEntries(fd.entries());
      const editId = data._editId;
      delete data._editId;

      try {
        if (editId) {
          await api(`/api/admin/sucursales/${editId}`, { method: 'PUT', body: data });
          showAlert('Sucursal actualizada.', 'success');
        } else {
          await api('/api/admin/sucursales', { method: 'POST', body: data });
          showAlert('Sucursal creada.', 'success');
        }
        viewState.sucursales.showForm = false;
        viewState.sucursales.editId = null;
        render();
      } catch (error) {
        showAlert(error.message, 'error');
      }
    });
  }
}

// ─── USUARIOS ─────────────────────────────────────────────────────────────────

function wireUsuariosPanel() {
  refs.content.querySelector('[data-action="nuevo-usuario"]')?.addEventListener('click', () => {
    viewState.usuarios.showForm = true;
    viewState.usuarios.editId = null;
    render();
  });

  refs.content.querySelector('[data-action="cerrar-usuario-form"]')?.addEventListener('click', () => {
    viewState.usuarios.showForm = false;
    viewState.usuarios.editId = null;
    render();
  });

  refs.content.querySelectorAll('[data-action="editar-usuario"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewState.usuarios.editId = btn.dataset.id;
      viewState.usuarios.showForm = false;
      render();
    });
  });

  refs.content.querySelectorAll('[data-action="toggle-usuario"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/usuarios/${btn.dataset.id}/toggle`, { method: 'PATCH' });
        showAlert('Estado de usuario actualizado.', 'success');
        render();
      } catch (error) {
        showAlert(error.message, 'error');
      }
    });
  });

  const formUser = document.getElementById('formUsuario');
  if (formUser) {
    formUser.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formUser);
      const data = Object.fromEntries(fd.entries());
      const editId = data._editId;
      delete data._editId;
      if (!data.password) delete data.password;

      try {
        if (editId) {
          await api(`/api/admin/usuarios/${editId}`, { method: 'PUT', body: data });
          showAlert('Usuario actualizado.', 'success');
        } else {
          await api('/api/admin/usuarios', { method: 'POST', body: data });
          showAlert('Usuario creado.', 'success');
        }
        viewState.usuarios.showForm = false;
        viewState.usuarios.editId = null;
        render();
      } catch (error) {
        showAlert(error.message, 'error');
      }
    });
  }
}

// ─── AUDITORÍA ────────────────────────────────────────────────────────────────

function wireAuditoriaFiltros() {
  const form = document.getElementById('auditoriaFilters');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    viewState.auditoria.usuario = fd.get('usuario') || '';
    viewState.auditoria.modulo = fd.get('modulo') || '';
    viewState.auditoria.accion = fd.get('accion') || '';
    viewState.auditoria.date_from = fd.get('date_from') || '';
    viewState.auditoria.date_to = fd.get('date_to') || '';
    viewState.auditoria.page = 1;
    render();
  });

  refs.content.querySelector('[data-action="limpiar-auditoria"]')?.addEventListener('click', () => {
    viewState.auditoria = { page: 1, usuario: '', modulo: '', accion: '', date_from: '', date_to: '' };
    render();
  });

  refs.content.querySelectorAll('[data-audit-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.auditPage);
      if (page >= 1) {
        viewState.auditoria.page = page;
        render();
      }
    });
  });
}

// ─── CUADRES ─────────────────────────────────────────────────────────────────

function wireCuadresPanel() {
  refs.content.querySelectorAll('[data-action="ver-cuadre"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      viewState.cuadres.selectedId = btn.dataset.id === viewState.cuadres.selectedId ? null : btn.dataset.id;
      render();
    });
  });

  refs.content.querySelectorAll('.clickable-row[data-cuadre-id]').forEach((row) => {
    row.addEventListener('click', () => {
      viewState.cuadres.selectedId = row.dataset.cuadreId === viewState.cuadres.selectedId ? null : row.dataset.cuadreId;
      render();
    });
  });

  refs.content.querySelector('[data-action="cerrar-cuadre-detalle"]')?.addEventListener('click', () => {
    viewState.cuadres.selectedId = null;
    render();
  });
}

// ─── FISCAL ───────────────────────────────────────────────────────────────────

function wireFiscalPanel() {
  const formFiscal = document.getElementById('formFiscalConfig');
  if (formFiscal) {
    formFiscal.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(formFiscal);
      const data = Object.fromEntries(fd.entries());
      const feedback = document.getElementById('fiscalFeedback');
      try {
        await api('/api/fiscal/config', { method: 'POST', body: data });
        showAlert('Configuración fiscal guardada (modo preparación).', 'success');
        if (feedback) feedback.textContent = '✓ Guardado correctamente.';
        render();
      } catch (error) {
        showAlert(error.message, 'error');
        if (feedback) feedback.textContent = error.message;
      }
    });
  }

  refs.content.querySelector('[data-action="fiscal-status"]')?.addEventListener('click', async () => {
    const feedback = document.getElementById('fiscalFeedback');
    try {
      const res = await api('/api/fiscal/status');
      if (feedback) feedback.textContent = `Estado: ${res.data?.mode || 'PREPARACION'} | Config: ${JSON.stringify(res.data?.configuracion || {})}`;
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    }
  });

  refs.content.querySelectorAll('[data-action="fiscal-xml"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/fiscal/documents/${btn.dataset.docid}/xml`, { method: 'POST' });
        showAlert('XML generado.', 'success');
      } catch (e) { showAlert(e.message, 'error'); }
    });
  });

  refs.content.querySelectorAll('[data-action="fiscal-sign"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/fiscal/documents/${btn.dataset.docid}/sign`, { method: 'POST' });
        showAlert('Documento firmado (simulación).', 'success');
      } catch (e) { showAlert(e.message, 'error'); }
    });
  });

  refs.content.querySelectorAll('[data-action="fiscal-send"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/fiscal/documents/${btn.dataset.docid}/send`, { method: 'POST' });
        showAlert('Envío simulado (modo preparación - DGII no conectada).', 'info');
      } catch (e) { showAlert(e.message, 'error'); }
    });
  });
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────

function wireConfiguracion() {
  const form = document.getElementById('formConfigGeneral');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const feedback = document.getElementById('configFeedback');
    try {
      await api('/api/admin/config', { method: 'PUT', body: data });
      showAlert('Configuración guardada correctamente.', 'success');
      if (feedback) feedback.textContent = '✓ Guardado.';
      render();
    } catch (error) {
      showAlert(error.message, 'error');
      if (feedback) feedback.textContent = error.message;
    }
  });

  const printForm = document.getElementById('formPrintConfig');
  if (!printForm) return;

  const fields = {
    pcNombreEmpresa: ['pv-nombre', 'pv-etq-nombre'],
    pcSubtitulo:     ['pv-subtitulo', 'pv-etq-subtitulo'],
    pcMensajeFinal:  ['pv-mensaje'],
  };

  const syncPreview = () => {
    for (const [inputId, targetIds] of Object.entries(fields)) {
      const val = document.getElementById(inputId)?.value || '';
      for (const tid of targetIds) {
        const el = document.getElementById(tid);
        if (el) el.textContent = val;
      }
    }
    const tel = document.getElementById('pcTelefono')?.value || '';
    const rnc = document.getElementById('pcRnc')?.value || '';
    const combined = [tel ? `Tel: ${tel}` : '', rnc ? `RNC: ${rnc}` : ''].filter(Boolean).join('  ');
    const telRncEl = document.getElementById('pv-tel-rnc');
    if (telRncEl) {
      telRncEl.textContent = combined;
      telRncEl.style.display = combined ? '' : 'none';
    }
  };

  printForm.addEventListener('input', syncPreview);
  syncPreview();

  printForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(printForm);
    const pcfg = getPrinterConfig();
    pcfg.nombre_empresa = fd.get('nombre_empresa') || pcfg.nombre_empresa;
    pcfg.subtitulo      = fd.get('subtitulo')      || pcfg.subtitulo;
    pcfg.telefono       = fd.get('telefono')        || '';
    pcfg.rnc            = fd.get('rnc')             || '';
    pcfg.mensaje_final  = fd.get('mensaje_final')   || pcfg.mensaje_final;

    const feedback = document.getElementById('printConfigFeedback');
    try {
      await api('/api/print/config', {
        method: 'PUT',
        body: {
          impresora_termica:  pcfg.termica       || '',
          impresora_adhesiva: pcfg.adhesiva      || '',
          nombre_empresa:     pcfg.nombre_empresa,
          subtitulo:          pcfg.subtitulo,
          telefono_empresa:   pcfg.telefono,
          rnc:                pcfg.rnc,
          mensaje_final:      pcfg.mensaje_final,
          adhesiva_tipo:      pcfg.adhesiva_tipo || 'normal',
        },
      });
      setPrinterConfig(pcfg.termica, pcfg.adhesiva);
      if (feedback) { feedback.textContent = '✓ Configuración guardada en el servidor.'; feedback.className = 'hint success'; }
    } catch (err) {
      setPrinterConfig(pcfg.termica, pcfg.adhesiva);
      if (feedback) { feedback.textContent = `⚠ Guardado solo localmente: ${err.message}`; feedback.className = 'hint'; }
    }
  });
}

// ─── VENTAS PANEL ─────────────────────────────────────────────────────────────

function wireVentasPanel() {
  refs.content.querySelector('[data-action="hacer-cierre"]')?.addEventListener('click', () => {
    currentView = 'cierre_caja';
    render();
  });
}

// ─── ENVÍO FORM ───────────────────────────────────────────────────────────────

function wireEnvioForm() {
  const form = document.getElementById('formEnvio');
  if (!form) return;

  const telInput = form.querySelector('[name="telefono"]');
  const auto = document.getElementById('autocompleteCliente');
  const preview = document.getElementById('previewEnvio');

  telInput.addEventListener('input', () => {
    const tel = telInput.value.replace(/\D/g, '');
    const c = db.clientes.find((x) => x.telefono === tel);
    if (c) {
      form.nombre.value = c.nombre;
      form.cedula.value = c.cedula || '';
      form.direccion.value = c.direccion || '';
      if (auto) auto.textContent = `✓ Cliente encontrado: ${c.nombre} (${c.telefono})`;
    } else {
      if (auto) auto.textContent = 'Cliente no encontrado. Se registrará automáticamente al enviar.';
    }
  });

  form.addEventListener('input', () => {
    if (preview) {
      preview.innerHTML = `<b>Vista previa:</b> ${form.nombre.value || '-'} | ${form.descripcion?.value || '-'} | ${Number(form.monto?.value || 0).toFixed(2)} RD$`;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.telefono = payload.telefono.replace(/\D/g, '');
    // Sucursal origen = sucursal asignada al empleado que está haciendo el envío
    payload.sucursal_origen = getCurrentUser().sucursal_id;
    try {
      const result = await api('/api/ops/envios', {
        method: 'POST',
        headers: { 'x-idempotency-key': crypto.randomUUID() },
        body: payload,
      });
      const pkg = result.data;
      const _dest = db.sucursales.find((s) => s.id === payload.sucursal_destino)?.nombre || '-';
      const _orig = db.sucursales.find((s) => s.id === getCurrentUser().sucursal_id)?.nombre || '-';
      const printResult = await printSaleDocuments(
        {
          guia: pkg.guia,
          cliente: payload.nombre,
          telefono_cliente: payload.telefono || '',
          descripcion: payload.descripcion || '',
          color: payload.color_empaque || '',
          monto: Number(payload.monto).toFixed(2),
          metodo_pago: payload.metodo_pago || 'EFECTIVO',
          destino: _dest,
          origen: _orig,
          operador: getCurrentUser().username,
          fecha: new Date().toISOString(),
        },
        { guia: pkg.guia, destino: _dest, codigo_barras: `ASTRAPU-${pkg.guia.split('-')[1]}` },
      );
      showAlert(`Envío registrado ${pkg.guia}. ${printResult.message}`, printResult.ok ? 'success' : 'info');
      logAudit({ modulo: 'impresion', accion: 'print_after_envio', entidad: 'paquetes', entidad_id: pkg.paquete_id, resultado: printResult.ok ? 'OK' : 'ERROR', observacion: printResult.message });
      form.reset();
      await render();
    } catch (error) {
      showAlert(error.message, 'error');
    }
  });

  form.querySelector('[data-action="reimprimir-ultimo"]')?.addEventListener('click', async () => {
    const last = db.paquetes[0];
    if (!last) return showAlert('No hay paquetes para reimprimir.', 'error');
    const _lCli  = db.clientes.find((c) => c.id === last.cliente_id);
    const _lDest = db.sucursales.find((s) => s.id === last.sucursal_destino)?.nombre || '-';
    const printResult = await printSaleDocuments(
      {
        guia: last.guia,
        cliente: last.cliente_nombre || _lCli?.nombre || '-',
        telefono_cliente: last.telefono_destinatario || _lCli?.telefono || '',
        descripcion: last.descripcion || 'Paquete',
        color: last.color_empaque || '',
        monto: (last.monto || 0).toFixed(2),
        metodo_pago: 'EFECTIVO',
        destino: _lDest,
        origen: db.sucursales.find((s) => s.id === last.sucursal_origen)?.nombre || '-',
        operador: getCurrentUser().username,
        fecha: last.created_at || new Date().toISOString(),
      },
      { guia: last.guia, destino: _lDest, codigo_barras: last.codigo_barras },
    );
    logAudit({ modulo: 'impresion', accion: 'reimpresion', entidad: 'paquetes', entidad_id: last.id, resultado: printResult.ok ? 'OK' : 'ERROR', observacion: printResult.message });
    showAlert(printResult.message, printResult.ok ? 'success' : 'error');
  });
}

// ─── ESCANEO ──────────────────────────────────────────────────────────────────

let scanCounter = 0;
let scanBusy = false;
let audioCtx = null;
function getAudio() {
  if (audioCtx) return audioCtx;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audioCtx = null; }
  return audioCtx;
}
function beep(ok) {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (ok) {
      osc.frequency.value = 1500;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } else {
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.start(); osc.stop(ctx.currentTime + 0.5);
    }
  } catch (_) {}
  if (navigator.vibrate) {
    try { navigator.vibrate(ok ? 60 : [120, 60, 120]); } catch (_) {}
  }
}
function flashScan(ok) {
  const flash = document.getElementById('scanFlash');
  if (!flash) return;
  flash.className = `scan-flash ${ok ? 'ok' : 'err'} show`;
  setTimeout(() => { if (flash) flash.className = 'scan-flash'; }, 350);
}
function updateScanLast(ok, guia, detail) {
  const last = document.getElementById('scanLast');
  const st   = document.getElementById('scanLastStatus');
  const g    = document.getElementById('scanLastGuia');
  const d    = document.getElementById('scanLastDetail');
  if (last) last.style.display = '';
  if (st) {
    st.textContent = ok ? '✓ OK' : '✗ ERROR';
    st.className = `scan-last-status ${ok ? 'ok' : 'err'}`;
  }
  if (g) g.textContent = guia || '—';
  if (d) d.textContent = detail || '';
  if (ok) {
    scanCounter++;
    const pill = document.getElementById('scanCounterPill');
    if (pill) pill.textContent = `${scanCounter} escaneado${scanCounter === 1 ? '' : 's'}`;
  }
}

function wireScanning() {
  const input = document.getElementById('scanInput');
  const tableEl = document.getElementById('scanTable');
  if (!input) return;

  scanCounter = 0;
  const pill = document.getElementById('scanCounterPill');
  if (pill) pill.textContent = '0 escaneados';

  const refreshTable = () => {
    const rows = db.movimientos_paquete.slice(0, 10).map((m) => {
      const p = db.paquetes.find((x) => x.id === m.paquete_id);
      return `<tr><td>${(m.created_at || m.fecha_hora || '').slice(11, 19)}</td><td>${p?.guia || '-'}</td><td>${m.estado_destino}</td><td>${m.detalle}</td></tr>`;
    }).join('');
    if (tableEl) tableEl.innerHTML = `<table><thead><tr><th>Hora</th><th>Guía</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const refocus = () => {
    const el = document.getElementById('scanInput');
    if (el) { el.value = ''; el.focus(); }
  };

  const process = async (raw) => {
    const code = raw.trim();
    if (!code) return;
    if (scanBusy) return;
    scanBusy = true;
    const mode = input.dataset.mode;
    const endpoint = mode === 'enviar' ? '/api/ops/paquetes/scan-send' : '/api/ops/paquetes/scan-receive';
    try {
      const result = await api(endpoint, {
        method: 'POST',
        headers: { 'x-idempotency-key': crypto.randomUUID() },
        body: { code },
      });
      if (result.ok) {
        beep(true); flashScan(true);
        const guia = result.data?.guia || code;
        const detail = mode === 'enviar' ? 'Despachado — EN TRÁNSITO' : 'Recibido en sucursal';
        updateScanLast(true, guia, detail);
        await syncDataFromBackend();
        refreshTable();
        const fb = document.getElementById('scanFeedback');
        if (fb) { fb.textContent = `✓ ${detail} — ${guia}`; fb.className = 'hint success'; }
      } else {
        beep(false); flashScan(false);
        updateScanLast(false, code, result.error || 'Error');
        const fb = document.getElementById('scanFeedback');
        if (fb) { fb.textContent = `✗ ${result.error}`; fb.className = 'hint error'; }
      }
    } catch (error) {
      beep(false); flashScan(false);
      updateScanLast(false, code, error.message || 'Error de red');
      const fb = document.getElementById('scanFeedback');
      if (fb) { fb.textContent = `✗ ${error.message}`; fb.className = 'hint error'; }
    } finally {
      scanBusy = false;
      refocus();
    }
  };

  // Captura por teclado: las pistolas envían texto rápido + Enter.
  // Procesamos con Enter (instantáneo) y como fallback con timeout en `input`.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(scanTimer);
      const v = input.value;
      process(v);
    }
  });
  input.addEventListener('input', () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (input.value.trim().length > 2) process(input.value);
    }, 250);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      const cur = document.getElementById('scanInput');
      if (cur && document.activeElement !== cur) cur.focus();
    }, 50);
  });

  refs.content.querySelectorAll('[data-action="scan-guia"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const guia = btn.dataset.guia;
      if (guia) { process(guia); }
    });
  });

  refs.content.querySelectorAll('[data-action="reimprimir-paquete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pkg = db.paquetes.find((p) => p.id === btn.dataset.id);
      if (!pkg) return;
      const _pCli  = db.clientes.find((c) => c.id === pkg.cliente_id);
      const clienteNom = pkg.cliente_nombre || _pCli?.nombre || '-';
      const destino = db.sucursales.find((s) => s.id === pkg.sucursal_destino)?.nombre || '-';
      const printResult = await printSaleDocuments(
        {
          guia: pkg.guia,
          cliente: clienteNom,
          telefono_cliente: pkg.telefono_destinatario || _pCli?.telefono || '',
          descripcion: pkg.descripcion || 'Paquete',
          color: pkg.color_empaque || '',
          monto: Number(pkg.monto || 0).toFixed(2),
          metodo_pago: 'EFECTIVO',
          destino,
          origen: db.sucursales.find((s) => s.id === pkg.sucursal_origen)?.nombre || '-',
          operador: getCurrentUser().username,
          fecha: pkg.created_at || new Date().toISOString(),
        },
        { guia: pkg.guia, destino, codigo_barras: pkg.codigo_barras || pkg.guia },
      );
      logAudit({ modulo: 'impresion', accion: 'reimpresion', entidad: 'paquetes', entidad_id: pkg.id, resultado: printResult.ok ? 'OK' : 'ERROR', observacion: printResult.message });
      showAlert(printResult.message, printResult.ok ? 'success' : 'info');
    });
  });

  refreshTable();
  input.focus();
}

// ─── BUSQUEDA ─────────────────────────────────────────────────────────────────

function wireBusqueda() {
  const input = document.getElementById('buscarTelefono');
  const result = document.getElementById('resultadoBusqueda');
  if (!input || !result) return;

  const renderResults = async () => {
    try {
      const rows = await api(`/api/ops/paquetes/search?phone=${encodeURIComponent(input.value.replace(/\D/g, ''))}`).then((r) => r.data || []);
      result.innerHTML = rows.map((p) => {
        const client = db.clientes.find((c) => c.id === p.cliente_id);
        const action = p.estado === 'DISPONIBLE'
          ? `<button class="btn primary" data-select-delivery="${p.id}">Ir a entregar</button>`
          : `<span class="badge ${p.estado.toLowerCase()}">${p.estado === 'EN_TRANSITO' ? 'En camino' : p.estado === 'PENDIENTE' ? 'Aún no ha salido' : p.estado === 'ENTREGADO' ? 'Ya entregado' : p.estado}</span>`;

        return `<article class="result-card">
          <h4>${p.guia}</h4>
          <p><b>Nombre:</b> ${p.cliente_nombre || client?.nombre || '-'}</p>
          <p><b>Teléfono:</b> ${p.telefono_destinatario}</p>
          <p><b>Origen:</b> ${db.sucursales.find((s) => s.id === p.sucursal_origen)?.nombre || '-'}</p>
          <p><b>Destino:</b> ${db.sucursales.find((s) => s.id === p.sucursal_destino)?.nombre || '-'}</p>
          <p><b>Estado:</b> ${p.estado}</p>
          <p><b>Registro:</b> ${(p.created_at || '').slice(0, 16).replace('T', ' ')}</p>
          ${action}
        </article>`;
      }).join('') || '<p class="hint">Sin resultados.</p>';

      result.querySelectorAll('[data-select-delivery]').forEach((btn) => btn.addEventListener('click', () => {
        selectedDeliveryPackage = btn.dataset.selectDelivery;
        currentView = 'entregar_paquete';
        logAudit({ modulo: 'entrega', accion: 'busqueda_sensible', entidad: 'paquetes', entidad_id: selectedDeliveryPackage });
        render();
      }));
    } catch (error) {
      result.innerHTML = `<p class="hint error">${error.message}</p>`;
    }
  };

  input.addEventListener('input', renderResults);
  renderResults();
}

// ─── ENTREGA ──────────────────────────────────────────────────────────────────

function wireEntrega() {
  const preview = document.getElementById('entregaSeleccion');
  const cedula = document.getElementById('cedulaEntrega');
  const scan = document.getElementById('scanEntrega');
  const btn = document.getElementById('confirmarEntregaBtn');
  const feedback = document.getElementById('entregaFeedback');
  if (!btn) return;

  if (selectedDeliveryPackage) {
    const p = db.paquetes.find((x) => x.id === selectedDeliveryPackage);
    const c = db.clientes.find((x) => x.id === p?.cliente_id);
    if (preview && p) {
      preview.innerHTML = `<b>Paquete seleccionado:</b> ${p.guia} | ${p.cliente_nombre || c?.nombre || '-'} | Estado: ${p.estado}`;
    }
  }

  btn.addEventListener('click', () => {
    if (!selectedDeliveryPackage) {
      if (feedback) feedback.textContent = 'Debe seleccionar un paquete desde Buscar paquete.';
      return;
    }
    api('/api/ops/paquetes/delivery/session', {
      method: 'POST',
      body: { paquete_id: selectedDeliveryPackage, cedula: cedula.value },
    }).then((sessionRes) => {
      selectedDeliverySession = sessionRes.data.session_id;
      return api('/api/ops/paquetes/delivery/confirm', {
        method: 'POST',
        body: { session_id: selectedDeliverySession, scanned_code: scan.value.trim() },
      });
    }).then(async (finalRes) => {
      if (feedback) {
        feedback.textContent = finalRes.ok ? '✓ Entrega confirmada exitosamente' : finalRes.error;
        feedback.className = `hint ${finalRes.ok ? 'success' : 'error'}`;
      }
      if (finalRes.ok) {
        selectedDeliveryPackage = null;
        selectedDeliverySession = null;
      }
      await render();
    }).catch((error) => {
      if (feedback) { feedback.textContent = error.message; feedback.className = 'hint error'; }
    });
  });
}

// ─── CIERRE ───────────────────────────────────────────────────────────────────

function wireCierre() {
  const form = document.getElementById('formCierre');
  if (!form) return;
  form.addEventListener('submit', (e) => e.preventDefault());
  const btn = form.querySelector('[data-action="confirmar-cierre"]');
  btn?.addEventListener('click', () => {
    const fd = new FormData(form);
    api('/api/ops/ventas/close', { method: 'POST', body: Object.fromEntries(fd.entries()) })
      .then((resp) => {
        showAlert(`Cierre ${resp.data.cierre_id} creado. Diferencia RD$ ${Number(resp.data.diferencia).toFixed(2)}`, 'success');
        render();
      })
      .catch((error) => showAlert(error.message, 'error'));
  });
}

// ─── IMPRESORAS ───────────────────────────────────────────────────────────────

async function populatePrinterSelectors() {
  const t = document.getElementById('printerTermica');
  const a = document.getElementById('printerAdhesiva');
  if (!t || !a) return;
  const printers = await getPrinters();
  const options = ['<option value="">Seleccione...</option>', ...printers.map((p) => `<option value="${p}">${p}</option>`)].join('');
  t.innerHTML = options;
  a.innerHTML = options;
  const cfg = getPrinterConfig();
  if (cfg.termica) t.value = cfg.termica;
  if (cfg.adhesiva) a.value = cfg.adhesiva;
}

function wirePrinters() {
  const feedback = document.getElementById('printFeedback');
  if (!feedback) return;

  refs.content.querySelector('[data-action="connect-qz"]')?.addEventListener('click', async () => {
    feedback.textContent = '⏳ Conectando a QZ Tray...';
    feedback.className = 'hint';
    const result = await connectQZ();
    if (result.ok) {
      showAlert(`✓ QZ Tray conectado — ${result.printers?.length || 0} impresoras detectadas.`, 'success');
      await populatePrinterSelectors();
      render();
    } else if (result.error === 'QZ_LIB_NOT_LOADED') {
      feedback.textContent = '✗ La librería QZ Tray no cargó correctamente. Recargue la página (F5) e intente nuevamente. Si el problema persiste, verifique que no haya extensiones del navegador bloqueando scripts.';
      feedback.className = 'hint error';
    } else if (result.error === 'QZ_NOT_RUNNING') {
      feedback.textContent = '✗ QZ Tray no está en ejecución en este computador. Ábralo desde el menú de inicio / aplicaciones y vuelva a intentar.';
      feedback.className = 'hint error';
    } else if (result.error === 'CERT_ERROR') {
      feedback.innerHTML = '✗ El navegador bloqueó la conexión por certificado no confiable.<br>Abra <a href="https://localhost:8182" target="_blank" style="color:var(--brand-500)">https://localhost:8182</a> y <a href="https://localhost:8183" target="_blank" style="color:var(--brand-500)">https://localhost:8183</a> en nuevas pestañas, acepte la excepción de seguridad en cada una y vuelva a conectar.';
      feedback.className = 'hint error';
    } else {
      feedback.textContent = `✗ ${result.error || 'No se pudo conectar. Verifique que QZ Tray esté en ejecución en este computador.'}`;
      feedback.className = 'hint error';
    }
  });

  refs.content.querySelector('[data-action="disconnect-qz"]')?.addEventListener('click', async () => {
    await disconnectQZ();
    showAlert('QZ Tray desconectado.', 'info');
    render();
  });

  refs.content.querySelector('[data-action="save-printers"]')?.addEventListener('click', async () => {
    const t = document.getElementById('printerTermica');
    const a = document.getElementById('printerAdhesiva');
    if (t && a) {
      setPrinterConfig(t.value, a.value);
      const pcfg = getPrinterConfig();
      try {
        const tipoEl = document.getElementById('adhesivaTipo');
        if (tipoEl) { db.configuracion_impresoras.adhesiva_tipo = tipoEl.value; }
        await api('/api/print/config', {
          method: 'PUT',
          body: {
            impresora_termica:  t.value || '',
            impresora_adhesiva: a.value || '',
            nombre_empresa:     pcfg.nombre_empresa  || 'ASTRAPU',
            subtitulo:          pcfg.subtitulo       || '',
            telefono_empresa:   pcfg.telefono        || '',
            rnc:                pcfg.rnc             || '',
            mensaje_final:      pcfg.mensaje_final   || '',
            adhesiva_tipo:      pcfg.adhesiva_tipo   || 'normal',
          },
        });
        feedback.textContent = '✓ Configuración de impresoras guardada en el servidor.';
      } catch {
        feedback.textContent = '✓ Guardado localmente (servidor no disponible).';
      }
      feedback.className = 'hint success';
    }
  });

  refs.content.querySelector('[data-action="test-termica"]')?.addEventListener('click', async () => {
    feedback.textContent = 'Enviando prueba térmica...';
    feedback.className = 'hint';
    const pkt = db.paquetes[0];
    const testTicket = pkt ? {
      guia:             pkt.guia,
      cliente:          pkt.cliente_nombre || db.clientes.find((c) => c.id === pkt.cliente_id)?.nombre || 'Cliente Prueba',
      monto:            pkt.monto || '500',
      telefono_cliente: pkt.telefono_destinatario || '',
      descripcion:      pkt.descripcion || 'Paquete de prueba',
      color:            pkt.color_empaque || '',
      destino:          db.sucursales.find((s) => s.id === pkt.sucursal_destino)?.nombre || 'Sucursal destino',
      origen:           db.sucursales.find((s) => s.id === pkt.sucursal_origen)?.nombre  || 'Sucursal origen',
      operador:         db.usuarios.find((u) => u.id === pkt.usuario_id)?.username || 'admin',
      fecha:            pkt.created_at,
      metodo_pago:      'EFECTIVO',
    } : { guia: 'TEST-THERMAL', cliente: 'Prueba Astrapu', monto: '590', descripcion: 'Documentos varios', destino: 'Santiago Norte', origen: 'Santo Domingo Centro', operador: 'admin', metodo_pago: 'EFECTIVO' };
    const r = await printThermalTicket(testTicket);
    feedback.textContent = r.ok ? `✓ Prueba térmica enviada (${testTicket.guia}).` : `✗ ${r.error}`;
    feedback.className = `hint ${r.ok ? 'success' : 'error'}`;
  });

  refs.content.querySelector('[data-action="test-adhesiva"]')?.addEventListener('click', async () => {
    feedback.textContent = 'Enviando prueba de etiqueta...';
    feedback.className = 'hint';
    const pkt = db.paquetes[0];
    const testLabel = pkt ? {
      guia:          pkt.guia,
      destino:       db.sucursales.find((s) => s.id === pkt.sucursal_destino)?.nombre || 'Sucursal destino',
      origen:        db.sucursales.find((s) => s.id === pkt.sucursal_origen)?.nombre  || 'Sucursal origen',
      codigo_barras: pkt.codigo_barras || pkt.guia,
    } : { guia: 'TEST-LABEL', destino: 'SUCURSAL TEST', origen: 'Santo Domingo', codigo_barras: 'ASTRAPU-000000001' };
    const r = await printAdhesiveLabel(testLabel);
    feedback.textContent = r.ok ? `✓ Prueba de etiqueta enviada (${testLabel.guia}).` : `✗ ${r.error}`;
    feedback.className = `hint ${r.ok ? 'success' : 'error'}`;
  });

  populatePrinterSelectors();
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  logAudit({ modulo: 'auth', accion: 'logout', entidad: 'usuarios', entidad_id: getCurrentUser()?.id });
  logout();
  showLoginScreen();
});

// ─── SUPER ADMIN ROLE SWITCHER ────────────────────────────────────────────────

document.getElementById('superRoleSelect')?.addEventListener('change', (e) => {
  if (!isSuperAdmin()) return;
  const newRole = e.target.value;
  setSimulatedRole(newRole);
  currentView = defaultViewByRole[newRole] || 'dashboard';
  viewState.paquetes.selectedId = null;
  viewState.cuadres.selectedId = null;
  render();
});

// ─── HAMBURGER MENU (MÓVIL) ───────────────────────────────────────────────────

function wireMobileMenu() {
  const shell = document.getElementById('appShell');
  const overlay = document.getElementById('sidebarOverlay');
  const toggle = document.getElementById('menuToggle');
  const closeBtn = document.getElementById('sidebarClose');

  const openSidebar = () => shell.classList.add('sidebar-open');
  const closeSidebar = () => shell.classList.remove('sidebar-open');

  toggle?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);
  closeBtn?.addEventListener('click', closeSidebar);

  document.getElementById('sideMenu')?.addEventListener('click', () => {
    if (window.innerWidth <= 960) closeSidebar();
  });
}

wireMobileMenu();

// ─── AUTO-CONNECT QZ TRAY ────────────────────────────────────────────────────

async function tryAutoConnectQZ() {
  if (!window.qz) return;
  try {
    const result = await connectQZ();
    if (result.ok) {
      render();
    }
  } catch (_) {
  }
}

// ─── INTELIGENCIA DE RUTAS ────────────────────────────────────────────────────

async function wireInteligencia() {
  if (!document.getElementById('etaRecomendaciones')) return;

  const DIAS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const TIPO_ICON = { trafico: '🚦', eficiencia: '📈', general: '💡' };
  const CONFIANZA_LABEL = {
    confianza_alta: '🟢 Alta',
    confianza_media: '🟡 Media',
    confianza_baja: '🟠 Baja',
    aprendiendo: '⏳ Aprendiendo',
  };

  const renderAll = async () => {
    const [recsRes, effRes] = await Promise.all([
      api('/api/eta/recommendations'),
      api('/api/eta/efficiency'),
    ]).catch(() => [{ data: [] }, { data: [] }]);

    // ── Recomendaciones ──────────────────────────────────────────────────────
    const recsEl = document.getElementById('etaRecomendaciones');
    if (recsEl) {
      const recs = recsRes?.data || [];
      if (recs.length === 0) {
        const hint = getCurrentUser().rol === 'admin'
          ? 'No hay recomendaciones activas esta semana. Haga clic en "Generar recomendaciones IA" para crearlas.'
          : 'No hay recomendaciones activas esta semana.';
        recsEl.innerHTML = `<div class="hint" style="padding:.6rem 0">${hint}</div>`;
      } else {
        recsEl.innerHTML = recs.map((r) => `
          <div style="border:1px solid var(--gray-200);border-radius:.55rem;padding:.85rem 1rem;margin-bottom:.7rem;display:flex;align-items:flex-start;gap:.75rem">
            <span style="font-size:1.35rem;line-height:1">${TIPO_ICON[r.tipo] || '💡'}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;margin-bottom:.2rem">${r.titulo}</div>
              <div style="color:var(--gray-600);font-size:.9rem;line-height:1.45">${r.mensaje}</div>
            </div>
            <button class="btn btn-sm" data-action="accept-rec" data-id="${r.id}" style="white-space:nowrap;flex-shrink:0">✓ Aceptar</button>
          </div>`).join('');
      }
    }

    // ── Eficiencia por día ───────────────────────────────────────────────────
    const effEl = document.getElementById('etaEficiencia');
    if (effEl) {
      const stats = effRes?.data || [];
      const byDay = {};
      for (const s of stats) {
        for (const [d, m] of Object.entries(s.promedio_por_dia || {})) {
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(Number(m));
        }
      }
      const dayEntries = Object.entries(byDay).map(([d, vals]) => ({
        label: DIAS_SHORT[Number(d)] || `D${d}`,
        avg: vals.reduce((a, b) => a + b, 0) / vals.length,
      }));
      if (dayEntries.length === 0) {
        effEl.innerHTML = `<div class="hint" style="padding:.6rem 0">El sistema está en período de aprendizaje. Los datos aparecerán cuando haya suficientes envíos completados.</div>`;
      } else {
        const maxVal = Math.max(...dayEntries.map((d) => d.avg), 1);
        effEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:.5rem 1rem;padding:.6rem 0">
          ${dayEntries.map(({ label, avg }) => {
            const pct = Math.round((avg / maxVal) * 100);
            const h = Math.floor(avg / 60);
            const m = Math.round(avg % 60);
            const timeStr = h > 0 ? `${h}h ${m}m` : `${m} min`;
            return `<div>
              <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:.25rem">
                <span style="font-weight:600">${label}</span>
                <span style="color:var(--gray-500)">${timeStr}</span>
              </div>
              <div style="height:8px;background:var(--gray-100);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:var(--brand-500);border-radius:4px;transition:width .3s"></div>
              </div>
            </div>`;
          }).join('')}
        </div>`;
      }
    }

    // ── Rutas ────────────────────────────────────────────────────────────────
    const rutasEl = document.getElementById('etaRutas');
    if (rutasEl) {
      const stats = effRes?.data || [];
      if (stats.length === 0) {
        rutasEl.innerHTML = `<div class="hint" style="padding:.6rem 0">No hay datos de rutas registrados aún. Los datos se generan automáticamente al despachar y recibir paquetes.</div>`;
      } else {
        const sorted = [...stats].sort((a, b) => b.muestras_totales - a.muestras_totales);
        const rows = sorted.map((s) => {
          const h = Math.floor(s.promedio_general_minutos / 60);
          const m = Math.round(s.promedio_general_minutos % 60);
          const timeStr = h > 0 ? `${h}h ${m}m` : `${m} min`;
          return `<tr>
            <td>${s.origen_nombre}</td>
            <td>${s.destino_nombre}</td>
            <td><b>${timeStr}</b></td>
            <td>${s.muestras_totales}</td>
            <td>${CONFIANZA_LABEL[s.estado_modelo] || '—'}</td>
          </tr>`;
        }).join('');
        rutasEl.innerHTML = `<div class="table-wrap"><table>
          <thead><tr><th>Origen</th><th>Destino</th><th>Tiempo promedio</th><th>Muestras</th><th>Confianza</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`;
      }
    }

    // Wire accept buttons
    document.querySelectorAll('[data-action="accept-rec"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await api(`/api/eta/recommendations/${btn.dataset.id}/accept`, { method: 'POST' });
        await renderAll();
      });
    });

    // Wire generate button
    const genBtn = document.getElementById('btnGenerateRecs');
    if (genBtn) {
      genBtn.addEventListener('click', async () => {
        genBtn.disabled = true;
        genBtn.textContent = 'Generando...';
        try {
          const result = await api('/api/eta/recommendations/generate', { method: 'POST' });
          if (result.ok) {
            const msg = result.data?.message || `${result.data?.generated ?? 0} recomendación(es) generada(s)`;
            showAlert(msg, 'info');
            await renderAll();
          } else {
            showAlert(result.data?.message || result.error || 'Error al generar recomendaciones', 'error');
            genBtn.disabled = false;
            genBtn.textContent = '✨ Generar recomendaciones IA';
          }
        } catch (e) {
          showAlert(e.message, 'error');
          genBtn.disabled = false;
          genBtn.textContent = '✨ Generar recomendaciones IA';
        }
      });
    }
  };

  await renderAll();
}

// ─── CAPTURA GLOBAL DE ESCÁNER ────────────────────────────────────────────────
// Las pistolas lectoras simulan pulsaciones de teclado rápidas + Enter.
// Capturamos el escaneo aunque no haya foco y lo redirigimos al campo activo:
//   - #scanInput  → vista enviar/recibir paquetes (procesa al instante)
//   - #scanEntrega → vista entregar paquete

(function setupGlobalScanCapture() {
  let buf = '';
  let timer = null;

  document.addEventListener('keydown', (e) => {
    const scanInput   = document.getElementById('scanInput');
    const scanEntrega = document.getElementById('scanEntrega');
    const scanField   = scanInput || scanEntrega;
    if (!scanField) { buf = ''; return; }

    const active = document.activeElement;
    const isOtherInput = active && active !== scanField &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

    // Si hay otro input activo, dejamos que reciba normalmente.
    if (isOtherInput) { buf = ''; return; }

    // Si el foco YA está en el campo de escaneo, dejamos que el listener local lo maneje.
    if (active === scanField) return;

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Enter') {
      if (buf.length > 2) {
        scanField.value = buf.trim();
        scanField.focus();
        // dispara input + keydown Enter para que el handler local procese
        scanField.dispatchEvent(new Event('input', { bubbles: true }));
        scanField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      buf = '';
      clearTimeout(timer);
      e.preventDefault();
    } else if (e.key.length === 1) {
      buf += e.key;
      clearTimeout(timer);
      timer = setTimeout(() => { buf = ''; }, 300);
    }
  });

  // Mantener foco en el campo de escaneo cuando estamos en una vista de escaneo
  setInterval(() => {
    const scanInput = document.getElementById('scanInput');
    if (!scanInput) return;
    const active = document.activeElement;
    const isOtherInput = active && active !== scanInput &&
      (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.tagName === 'BUTTON');
    if (!isOtherInput && active !== scanInput) scanInput.focus();
  }, 1500);
}());

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = '';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginUsername')?.focus();
  document.getElementById('loginError').style.display = 'none';
}

function showAppShell() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = '';
}

function wireLoginForm() {
  const form     = document.getElementById('loginForm');
  const errDiv   = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');
  const btnText   = document.getElementById('loginBtnText');
  const spinner   = document.getElementById('loginSpinner');

  document.getElementById('togglePw')?.addEventListener('click', () => {
    const pw = document.getElementById('loginPassword');
    pw.type = pw.type === 'password' ? 'text' : 'password';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
      errDiv.textContent = 'Por favor ingresa usuario y contraseña.';
      errDiv.style.display = '';
      return;
    }

    errDiv.style.display = 'none';
    submitBtn.disabled = true;
    btnText.textContent = 'Verificando...';
    spinner.style.display = '';

    try {
      await loginAs(username, password);
      currentView = defaultViewByRole[getCurrentUser().rol];
      logAudit({ modulo: 'auth', accion: 'login', entidad: 'usuarios', entidad_id: getCurrentUser().id });
      showAppShell();
      render();
      setTimeout(tryAutoConnectQZ, 1500);
    } catch (error) {
      errDiv.textContent = error.message || 'Credenciales inválidas. Intenta de nuevo.';
      errDiv.style.display = '';
    } finally {
      submitBtn.disabled = false;
      btnText.textContent = 'Entrar';
      spinner.style.display = 'none';
    }
  });
}

// ─── INICIO ───────────────────────────────────────────────────────────────────

wireLoginForm();

// Si hay sesión guardada válida, entrar directo al app
const storedUser = getStoredUser();
if (storedUser) {
  currentView = defaultViewByRole[storedUser.rol];
  showAppShell();
  try {
    render();
    setTimeout(tryAutoConnectQZ, 1500);
  } catch (error) {
    showAlert(`Error al restaurar sesión: ${error.message}`, 'error');
  }
} else {
  showLoginScreen();
}
