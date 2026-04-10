import { MENUS, VIEW_LABELS } from './constants.js';
import { db, idx } from './data/store.js';
import { loginAs, getCurrentUser, getRoleMenu, canEdit } from './services/authService.js';
import { logAudit } from './services/auditService.js';
import { connectQZ, getPrinters, setPrinterConfig, getPrinterConfig, printThermalTicket, printAdhesiveLabel } from './services/qzService.js';
import { printSaleDocuments } from './services/printService.js';
import { renderView, menuButton } from './views.js';
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
    const [ventasRes, paquetesRes, cierresRes, auditRes] = await Promise.all([
      api('/api/ops/ventas'),
      api('/api/ops/paquetes'),
      api('/api/ops/cierres'),
      api('/api/auditoria?page=1&page_size=200'),
    ]);
    db.ventas = ventasRes.data || [];
    db.paquetes = paquetesRes.data || [];
    db.cierres_caja = cierresRes.data || [];
    db.auditoria = auditRes.data || [];
  } catch (error) {
    showAlert(`Sync backend: ${error.message}`, 'error');
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
    render();
  }));
}

function renderSession() {
  const user = getCurrentUser();
  refs.user.textContent = user.nombre;
  refs.roleLabel.textContent = user.rol.toUpperCase();
  refs.branch.textContent = db.sucursales.find((s) => s.id === user.sucursal_id)?.nombre || '-';
}

async function render() {
  const role = getCurrentUser().rol;
  if (!MENUS[role].includes(currentView)) currentView = defaultViewByRole[role];

  await syncDataFromBackend();

  refs.title.textContent = VIEW_LABELS[currentView];
  refs.subtitle.textContent = canEdit() ? 'Operación activa' : 'Solo lectura';
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

function wireViewInteractions() {
  wireEnvioForm();
  wireScanning();
  wireBusqueda();
  wireEntrega();
  wireCierre();
  wirePrinters();
}

function wireEnvioForm() {
  const form = document.getElementById('formEnvio');
  if (!form) return;

  const telInput = form.querySelector('[name="telefono"]');
  const auto = document.getElementById('autocompleteCliente');
  const preview = document.getElementById('previewEnvio');

  telInput.addEventListener('input', () => {
    const c = idx.byTelefono().get(telInput.value.replace(/\D/g, ''));
    if (c) {
      form.nombre.value = c.nombre;
      form.cedula.value = c.cedula || '';
      form.direccion.value = c.direccion || '';
      auto.textContent = `Cliente encontrado: ${c.nombre} (${c.telefono})`;
    } else {
      auto.textContent = 'Cliente no encontrado. Puede registrarlo rápido en este formulario.';
    }
  });

  form.addEventListener('input', () => {
    preview.innerHTML = `<b>Vista previa:</b> ${form.nombre.value || '-'} | ${form.descripcion.value || '-'} | Monto RD$ ${Number(form.monto.value || 0).toFixed(2)}`;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.telefono = payload.telefono.replace(/\D/g, '');
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

    showAlert(`Envío registrado ${pkg.guia}. ${printResult.message}`, printResult.ok ? 'success' : 'error');
    logAudit({ modulo: 'impresion', accion: 'print_after_envio', entidad: 'paquetes', entidad_id: pkg.paquete_id, resultado: printResult.ok ? 'OK' : 'ERROR', observacion: printResult.message });
    form.reset();
    await render();
  });

  const reprint = form.querySelector('[data-action="reimprimir-ultimo"]');
  reprint?.addEventListener('click', async () => {
    const last = db.paquetes[0];
    if (!last) return showAlert('No hay paquetes para reimprimir.', 'error');
    const printResult = await printSaleDocuments(
      { guia: last.guia, cliente: db.clientes.find((c) => c.id === last.cliente_id)?.nombre || '-', monto: last.monto.toFixed(2) },
      { guia: last.guia, destino: db.sucursales.find((s) => s.id === last.sucursal_destino)?.nombre || '-', codigo_barras: last.codigo_barras },
    );
    logAudit({ modulo: 'impresion', accion: 'reimpresion', entidad: 'paquetes', entidad_id: last.id, resultado: printResult.ok ? 'OK' : 'ERROR', observacion: printResult.message });
    showAlert(printResult.message, printResult.ok ? 'success' : 'error');
  });
}

function wireScanning() {
  const input = document.getElementById('scanInput');
  const feedback = document.getElementById('scanFeedback');
  const table = document.getElementById('scanTable');
  if (!input) return;

  const refreshTable = () => {
    const rows = db.movimientos_paquete.slice(0, 10).map((m) => {
      const p = db.paquetes.find((x) => x.id === m.paquete_id);
      return `<tr><td>${m.fecha_hora.slice(11, 19)}</td><td>${p?.guia || '-'}</td><td>${m.estado_destino}</td><td>${m.detalle}</td></tr>`;
    }).join('');
    table.innerHTML = `<table><thead><tr><th>Hora</th><th>Guía</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${rows}</tbody></table>`;
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
      feedback.textContent = result.ok ? `OK ${result.data.guia} -> ${result.data.estado}` : result.error;
      feedback.className = `hint ${result.ok ? 'success' : 'error'}`;
      input.value = '';
      input.focus();
      await syncDataFromBackend();
      refreshTable();
    }).catch((error) => {
      feedback.textContent = error.message;
      feedback.className = 'hint error';
      input.value = '';
      input.focus();
    });
  };

  input.addEventListener('input', () => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => process(input.value), 120);
  });

  refreshTable();
  input.focus();
}

function wireBusqueda() {
  const input = document.getElementById('buscarTelefono');
  const result = document.getElementById('resultadoBusqueda');
  if (!input || !result) return;

  const renderResults = async () => {
    const rows = await api(`/api/ops/paquetes/search?phone=${encodeURIComponent(input.value.replace(/\D/g, ''))}`).then((r) => r.data).catch(() => []);
    result.innerHTML = rows.map((p) => {
      const client = db.clientes.find((c) => c.id === p.cliente_id);
      const action = p.estado === 'DISPONIBLE'
        ? `<button class="btn primary" data-select-delivery="${p.id}">Ir a entregar</button>`
        : `<span class="tag">${p.estado === 'EN_TRANSITO' ? 'En camino' : p.estado === 'PENDIENTE' ? 'Aún no ha salido' : 'Ya entregado'}</span>`;

      return `<article class="result-card"><h4>${p.guia}</h4><p><b>Nombre:</b> ${client?.nombre || '-'}</p><p><b>Teléfono:</b> ${p.telefono_destinatario}</p><p><b>Origen:</b> ${db.sucursales.find((s)=>s.id===p.sucursal_origen)?.nombre || '-'}</p><p><b>Destino:</b> ${db.sucursales.find((s)=>s.id===p.sucursal_destino)?.nombre || '-'}</p><p><b>Estado:</b> ${p.estado}</p><p><b>Registro:</b> ${p.created_at.slice(0,16).replace('T',' ')}</p>${action}</article>`;
    }).join('');

    result.querySelectorAll('[data-select-delivery]').forEach((btn) => btn.addEventListener('click', () => {
      selectedDeliveryPackage = btn.dataset.selectDelivery;
      currentView = 'entregar_paquete';
      logAudit({ modulo: 'entrega', accion: 'busqueda_sensible', entidad: 'paquetes', entidad_id: selectedDeliveryPackage });
      render();
    }));
  };

  input.addEventListener('input', () => { renderResults(); });
  renderResults();
}

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
    preview.innerHTML = p ? `<b>Paquete seleccionado:</b> ${p.guia} | ${c?.nombre || '-'} | ${p.estado}` : preview.textContent;
  }

  btn.addEventListener('click', () => {
    if (!selectedDeliveryPackage) {
      feedback.textContent = 'Debe seleccionar un paquete desde Buscar paquete.';
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
      feedback.textContent = finalRes.ok ? 'Entrega confirmada' : finalRes.error;
      feedback.className = `hint ${finalRes.ok ? 'success' : 'error'}`;
      if (finalRes.ok) {
        selectedDeliveryPackage = null;
        selectedDeliverySession = null;
      }
      await render();
    }).catch((error) => {
      feedback.textContent = error.message;
      feedback.className = 'hint error';
    });
  });
}

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

  document.querySelector('[data-action="hacer-cierre"]')?.addEventListener('click', () => {
    currentView = 'cierre_caja';
    render();
  });
}

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

  document.querySelector('[data-action="connect-qz"]')?.addEventListener('click', async () => {
    const result = await connectQZ();
    showAlert(result.ok ? 'QZ Tray conectado.' : result.error, result.ok ? 'success' : 'error');
    await populatePrinterSelectors();
    render();
  });

  document.querySelector('[data-action="save-printers"]')?.addEventListener('click', () => {
    setPrinterConfig(document.getElementById('printerTermica').value, document.getElementById('printerAdhesiva').value);
    feedback.textContent = 'Configuración guardada.';
  });

  document.querySelector('[data-action="test-termica"]')?.addEventListener('click', async () => {
    const r = await printThermalTicket({ guia: 'TEST-THERMAL', cliente: 'PRUEBA', monto: '0.00' });
    feedback.textContent = r.ok ? 'Prueba térmica enviada.' : r.error;
  });

  document.querySelector('[data-action="test-adhesiva"]')?.addEventListener('click', async () => {
    const r = await printAdhesiveLabel({ guia: 'TEST-LABEL', destino: 'SUCURSAL', codigo_barras: 'TEST' });
    feedback.textContent = r.ok ? 'Prueba adhesiva enviada.' : r.error;
  });

  populatePrinterSelectors();
}

refs.role.addEventListener('change', async () => {
  try {
    await loginAs(refs.role.value);
    currentView = defaultViewByRole[getCurrentUser().rol];
    logAudit({ modulo: 'auth', accion: 'login', entidad: 'usuarios', entidad_id: getCurrentUser().id });
    render();
  } catch (error) {
    showAlert(`Error de autenticación: ${error.message}`, 'error');
  }
});

try {
  await loginAs('admin');
  logAudit({ modulo: 'auth', accion: 'login', entidad: 'usuarios', entidad_id: getCurrentUser().id });
  render();
} catch (error) {
  showAlert(`No se pudo conectar al backend: ${error.message}`, 'error');
}
