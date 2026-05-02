export const ROLES = {
  admin: 'ADMIN',
  envios: 'ENVIOS',
  entrega: 'ENTREGA/RECIBE',
  contable: 'CONTABLE',
};

export const PACKAGE_STATUS = {
  PENDIENTE: 'PENDIENTE',
  EN_TRANSITO: 'EN_TRANSITO',
  DISPONIBLE: 'DISPONIBLE',
  ENTREGADO: 'ENTREGADO',
  INCIDENCIA: 'INCIDENCIA',
  CANCELADO: 'CANCELADO',
};

export const FISCAL_STATUS = [
  'borrador',
  'listo_para_firmar',
  'firmado',
  'enviado',
  'en_proceso',
  'aceptado',
  'aceptado_condicional',
  'rechazado',
  'anulado',
  'error_tecnico',
];

export const MENUS = {
  admin: [
    'dashboard',
    'paquetes',
    'buscar_paquete',
    'clientes',
    'sucursales',
    'usuarios',
    'cuadres',
    'auditoria',
    'reportes',
    'facturacion',
    'inteligencia',
    'configuracion',
    'impresoras',
  ],
  envios: ['nuevo_envio', 'enviar_paquetes', 'buscar_paquete', 'historial_ventas', 'cierre_caja', 'clientes', 'inteligencia', 'mi_historial', 'perfil', 'impresoras'],
  entrega: ['recibir_paquetes', 'pendiente_notificar', 'buscar_paquete', 'entregar_paquete', 'paquetes_entregados', 'mi_historial', 'perfil'],
  contable: ['dashboard_contable', 'buscar_paquete', 'cuadres', 'ventas', 'paquetes', 'pendiente_notificar', 'auditoria', 'reportes', 'facturacion', 'perfil'],
};

export const VIEW_LABELS = {
  dashboard: 'Dashboard', paquetes: 'Paquetes', clientes: 'Clientes', sucursales: 'Sucursales', usuarios: 'Usuarios', cuadres: 'Cuadres', auditoria: 'Auditoría', reportes: 'Reportes', facturacion: 'Facturación electrónica', configuracion: 'Configuración', impresoras: 'Configuración de impresoras',
  nuevo_envio: 'Nuevo envío', enviar_paquetes: 'Enviar paquetes', historial_ventas: 'Historial de ventas', cierre_caja: 'Cierre de caja', mi_historial: 'Mi historial', perfil: 'Perfil',
  recibir_paquetes: 'Recibir paquetes', buscar_paquete: 'Paquetes disponibles', entregar_paquete: 'Entregar paquete', paquetes_entregados: 'Paquetes entregados',
  pendiente_notificar: 'Pendiente notificar',
  dashboard_contable: 'Dashboard contable', ventas: 'Ventas',
  inteligencia: 'Inteligencia de rutas',
};

export const VIEW_ICONS = {
  dashboard: '◈', paquetes: '📦', clientes: '👥', sucursales: '🏢', usuarios: '👤', cuadres: '🧾', auditoria: '🔍', reportes: '📊', facturacion: '🧾', configuracion: '⚙️', impresoras: '🖨️',
  nuevo_envio: '＋', enviar_paquetes: '🚚', historial_ventas: '📋', cierre_caja: '💰', mi_historial: '📋', perfil: '👤',
  recibir_paquetes: '📥', buscar_paquete: '📋', entregar_paquete: '✅', paquetes_entregados: '📦',
  pendiente_notificar: '📲',
  dashboard_contable: '◈', ventas: '💳',
  inteligencia: '🧠',
};
