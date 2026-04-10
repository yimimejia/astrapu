import { MENUS, VIEW_LABELS } from './constants.js';
import { db } from './data/store.js';
import { loginAs, getCurrentUser, getRoleMenu, canEdit } from './services/authService.js';
import { logAudit } from './services/auditService.js';
import { connectQZ, disconnectQZ, getPrinters, setPrinterConfig, getPrinterConfig, printThermalTicket, printAdhesiveLabel } from './services/qzService.js';
import { printSaleDocuments } from './services/printService.js';
import { renderView, menuButton, viewState } from './views.js';
import { api } from './services/apiClient.js';

const refs = {
  role: document.getElementById('roleSwitcher'),
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

let currentView = defaultViewByRole[getCurrentUser().rol];
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
    if (b.dataset.view !== 'enviar_paquetes') viewState.escaneo.despachados = [];
    currentView = b.dataset.view;
    viewState.paquetes.selectedId = null;
    viewState.cuadres.selectedId = null;
    render();
  }));
}

function renderSession() {
  const user = getCurrentUser();
  const branchName = db.sucursales.find((s) => s.id === user.sucursal_id)?.nombre || '-';
  refs.user.textContent = user.nombre;
  refs.roleLabel.textContent = user.rol.toUpperCase();
  refs.role.value = user.rol;
  refs.branch.textContent = branchName;
  refs.subtitle.textContent = `${user.nombre} · ${user.rol.toUpperCase()} · ${branchName}`;
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
      const printResult = await printSaleDocuments(
        { guia: pkg.guia, cliente: payload.nombre, monto: Number(payload.monto).toFixed(2) },
        { guia: pkg.guia, destino: db.sucursales.find((s) => s.id === payload.sucursal_destino)?.nombre || '-', codigo_barras: `ASTRAPU-${pkg.guia.split('-')[1]}` },
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
    const printResult = await printSaleDocuments(
      { guia: last.guia, cliente: last.cliente_nombre || db.clientes.find((c) => c.id === last.cliente_id)?.nombre || '-', monto: (last.monto || 0).toFixed(2) },
      { guia: last.guia, destino: db.sucursales.find((s) => s.id === last.sucursal_destino)?.nombre || '-', codigo_barras: last.codigo_barras },
    );
    logAudit({ modulo: 'impresion', accion: 'reimpresion', entidad: 'paquetes', entidad_id: last.id, resultado: printResult.ok ? 'OK' : 'ERROR', observacion: printResult.message });
    showAlert(printResult.message, printResult.ok ? 'success' : 'error');
  });
}

// ─── ESCANEO ──────────────────────────────────────────────────────────────────

function wireScanning() {
  const input = document.getElementById('scanInput');
  const feedback = document.getElementById('scanFeedback');
  const tableEl = document.getElementById('scanTable');
  if (!input) return;

  const refreshTable = () => {
    const rows = db.movimientos_paquete.slice(0, 10).map((m) => {
      const p = db.paquetes.find((x) => x.id === m.paquete_id);
      return `<tr><td>${(m.created_at || m.fecha_hora || '').slice(11, 19)}</td><td>${p?.guia || '-'}</td><td>${m.estado_destino}</td><td>${m.detalle}</td></tr>`;
    }).join('');
    if (tableEl) tableEl.innerHTML = `<table><thead><tr><th>Hora</th><th>Guía</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const process = (raw) => {
    const code = raw.trim();
    if (!code) return;
    const mode = input.dataset.mode;
    const endpoint = mode === 'enviar' ? '/api/ops/paquetes/scan-send' : '/api/ops/paquetes/scan-receive';
    api(endpoint, {
      method: 'POST',
      headers: { 'x-idempotency-key': crypto.randomUUID() },
      body: { code },
    }).then(async (result) => {
      if (result.ok && mode === 'enviar') {
        // Registrar en la lista de despachados de la sesión
        await syncDataFromBackend();
        const pkg = db.paquetes.find((p) => p.guia === result.data.guia);
        if (pkg) {
          const clienteNom = pkg.cliente_nombre || db.clientes.find((c) => c.id === pkg.cliente_id)?.nombre || '-';
          const destino = db.sucursales.find((s) => s.id === pkg.sucursal_destino)?.nombre || '-';
          viewState.escaneo.despachados.unshift({
            hora: new Date().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            guia: pkg.guia,
            cliente: clienteNom,
            descripcion: pkg.descripcion || '-',
            destino,
            monto: pkg.monto,
          });
        }
        await render();
      } else if (result.ok) {
        await syncDataFromBackend();
        refreshTable();
      } else {
        const feedbackEl = document.getElementById('scanFeedback');
        if (feedbackEl) { feedbackEl.textContent = result.error; feedbackEl.className = 'hint error'; }
        const inputEl = document.getElementById('scanInput');
        if (inputEl) { inputEl.value = ''; inputEl.focus(); }
      }
    }).catch((error) => {
      const feedbackEl = document.getElementById('scanFeedback');
      if (feedbackEl) { feedbackEl.textContent = error.message; feedbackEl.className = 'hint error'; }
      const inputEl = document.getElementById('scanInput');
      if (inputEl) { inputEl.value = ''; inputEl.focus(); }
    });
  };

  input.addEventListener('input', () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => process(input.value), 120);
  });

  refs.content.querySelectorAll('[data-action="scan-guia"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const guia = btn.dataset.guia;
      if (guia) { input.value = guia; process(guia); }
    });
  });

  refs.content.querySelectorAll('[data-action="reimprimir-paquete"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pkg = db.paquetes.find((p) => p.id === btn.dataset.id);
      if (!pkg) return;
      const clienteNom = pkg.cliente_nombre || db.clientes.find((c) => c.id === pkg.cliente_id)?.nombre || '-';
      const destino = db.sucursales.find((s) => s.id === pkg.sucursal_destino)?.nombre || '-';
      const printResult = await printSaleDocuments(
        { guia: pkg.guia, cliente: clienteNom, monto: Number(pkg.monto || 0).toFixed(2) },
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
        showAlert('Entrega completada.', 'success');
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

  refs.content.querySelector('[data-action="save-printers"]')?.addEventListener('click', () => {
    const t = document.getElementById('printerTermica');
    const a = document.getElementById('printerAdhesiva');
    if (t && a) {
      setPrinterConfig(t.value, a.value);
      feedback.textContent = '✓ Configuración de impresoras guardada.';
      feedback.className = 'hint success';
    }
  });

  refs.content.querySelector('[data-action="test-termica"]')?.addEventListener('click', async () => {
    feedback.textContent = 'Enviando prueba térmica...';
    feedback.className = 'hint';
    const r = await printThermalTicket({ guia: 'TEST-THERMAL', cliente: 'Prueba Astrapu', monto: '0.00' });
    feedback.textContent = r.ok ? '✓ Prueba térmica enviada correctamente.' : `✗ ${r.error}`;
    feedback.className = `hint ${r.ok ? 'success' : 'error'}`;
  });

  refs.content.querySelector('[data-action="test-adhesiva"]')?.addEventListener('click', async () => {
    feedback.textContent = 'Enviando prueba de etiqueta...';
    feedback.className = 'hint';
    const r = await printAdhesiveLabel({ guia: 'TEST-LABEL', destino: 'SUCURSAL TEST', codigo_barras: 'ASTRAPU-TEST' });
    feedback.textContent = r.ok ? '✓ Prueba de etiqueta enviada correctamente.' : `✗ ${r.error}`;
    feedback.className = `hint ${r.ok ? 'success' : 'error'}`;
  });

  populatePrinterSelectors();
}

// ─── SELECTOR DE ROL ──────────────────────────────────────────────────────────

refs.role.addEventListener('change', async () => {
  try {
    viewState.paquetes = { search: '', estado: '', selectedId: null };
    viewState.cuadres = { selectedId: null };
    viewState.clientes = { search: '', showForm: false, editId: null };
    viewState.sucursales = { showForm: false, editId: null };
    viewState.usuarios = { showForm: false, editId: null };
    viewState.auditoria = { page: 1, usuario: '', modulo: '', accion: '', date_from: '', date_to: '' };
    selectedDeliveryPackage = null;
    selectedDeliverySession = null;

    await loginAs(refs.role.value);
    currentView = defaultViewByRole[getCurrentUser().rol];
    logAudit({ modulo: 'auth', accion: 'login', entidad: 'usuarios', entidad_id: getCurrentUser().id });
    render();
  } catch (error) {
    showAlert(`Error de autenticación: ${error.message}`, 'error');
  }
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

// ─── INICIO ───────────────────────────────────────────────────────────────────

try {
  await loginAs('admin');
  logAudit({ modulo: 'auth', accion: 'login', entidad: 'usuarios', entidad_id: getCurrentUser().id });
  render();
  setTimeout(tryAutoConnectQZ, 1500);
} catch (error) {
  showAlert(`No se pudo conectar al backend: ${error.message}`, 'error');
}
