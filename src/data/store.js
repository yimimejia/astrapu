import { PACKAGE_STATUS } from '../constants.js';

const now = () => new Date().toISOString();

export const db = {
  sucursales: [
    { id: 'suc-1', nombre: 'Santo Domingo Centro', provincia: 'Santo Domingo' },
    { id: 'suc-2', nombre: 'Santiago Norte', provincia: 'Santiago' },
    { id: 'suc-3', nombre: 'La Vega Centro', provincia: 'La Vega' },
  ],
  usuarios: [
    { id: 'u-admin', username: 'admin', nombre: 'Administrador General', rol: 'admin', sucursal_id: 'suc-1' },
    { id: 'u-envios', username: 'm.perez', nombre: 'María Pérez', rol: 'envios', sucursal_id: 'suc-1' },
    { id: 'u-entrega', username: 'j.rodriguez', nombre: 'Juan Rodríguez', rol: 'entrega', sucursal_id: 'suc-2' },
    { id: 'u-contable', username: 'contable', nombre: 'Laura Contable', rol: 'contable', sucursal_id: 'suc-1' },
  ],
  clientes: [
    { id: 'c-1', telefono: '8095550001', nombre: 'Ana García', cedula: '001-1234567-8', direccion: 'Santo Domingo', historial: 'Frecuente' },
    { id: 'c-2', telefono: '8295551002', nombre: 'Luis Pérez', cedula: '002-2345678-9', direccion: 'Santiago', historial: 'Corporativo' },
  ],
  paquetes: [
    {
      id: 'p-1', guia: 'GUIA-000000001', codigo_barras: 'ASTRAPU-000000001', cliente_id: 'c-1',
      telefono_destinatario: '8095550001', descripcion: 'Documentos', color_empaque: 'Transparente',
      monto: 480, sucursal_origen: 'suc-1', sucursal_destino: 'suc-2', estado: PACKAGE_STATUS.EN_TRANSITO,
      created_at: now(), enviado_at: now(), recibido_at: null, entregado_at: null, usuario_id: 'u-envios', documento_fiscal_id: null,
    },
  ],
  movimientos_paquete: [],
  ventas: [],
  cierres_caja: [],
  cierre_ventas: [],
  auditoria: [],
  configuracion_fiscal: {
    id: 'cfg-fiscal-1',
    rnc: '',
    razon_social: '',
    nombre_comercial: '',
    direccion_fiscal: '',
    correo_fiscal: '',
    ambiente: 'PREPARACION',
    certificado_ref: '',
    certificado_password_ref: '',
    secuencias: {},
    estado_configuracion: 'incompleta',
    updated_at: null,
  },
  documentos_fiscales: [],
  eventos_fiscales: [],
  secuencias_guias: { actual: 1 },
  secuencias_fiscales: [
    {
      id: 'sf-31',
      tipo_documento: '31',
      serie: 'E31',
      secuencia_actual: 500000000,
      secuencia_maxima: 599999999,
      activa: true,
    },
  ],
  configuracion_impresoras: {
    termica: null,
    adhesiva: null,
    adhesiva_tipo: 'normal',
    nombre_empresa: 'ASTRAPU',
    subtitulo: 'Paquetería Interprovincial RD',
    telefono: '',
    rnc: '',
    mensaje_final: 'Gracias por preferirnos',
  },
  historial_impresion: [],
  rutas_estadisticas: {},
};

export const idx = {
  byTelefono: () => new Map(db.clientes.map((c) => [c.telefono, c])),
  byGuia: () => new Map(db.paquetes.map((p) => [p.guia, p])),
  byBarcode: () => new Map(db.paquetes.map((p) => [p.codigo_barras, p])),
};

export function nextGuia() {
  db.secuencias_guias.actual += 1;
  return `GUIA-${String(db.secuencias_guias.actual).padStart(9, '0')}`;
}

export function persistPrinterConfigLocal() {
  localStorage.setItem('astrapu_printers', JSON.stringify(db.configuracion_impresoras));
}

export function loadPrinterConfigLocal() {
  const raw = localStorage.getItem('astrapu_printers');
  if (!raw) return;
  try {
    db.configuracion_impresoras = { ...db.configuracion_impresoras, ...JSON.parse(raw) };
  } catch {
    // ignore malformed data
  }
}
