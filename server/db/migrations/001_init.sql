PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sucursales (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  provincia TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clientes (
  id TEXT PRIMARY KEY,
  telefono TEXT UNIQUE NOT NULL,
  cedula TEXT,
  nombre TEXT NOT NULL,
  direccion TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clientes_telefono ON clientes(telefono);
CREATE INDEX IF NOT EXISTS idx_clientes_cedula ON clientes(cedula);

CREATE TABLE IF NOT EXISTS secuencias_guias (
  id TEXT PRIMARY KEY,
  prefijo TEXT NOT NULL,
  valor_actual INTEGER NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS secuencias_fiscales (
  id TEXT PRIMARY KEY,
  tipo_documento TEXT NOT NULL,
  serie TEXT NOT NULL,
  secuencia_actual INTEGER NOT NULL,
  secuencia_maxima INTEGER,
  activa INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracion_fiscal (
  id TEXT PRIMARY KEY,
  rnc TEXT,
  razon_social TEXT,
  nombre_comercial TEXT,
  direccion_fiscal TEXT,
  correo_fiscal TEXT,
  ambiente TEXT,
  certificado_ref TEXT,
  certificado_password_ref TEXT,
  secuencias TEXT,
  estado_configuracion TEXT,
  parametros TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ventas (
  id TEXT PRIMARY KEY,
  paquete_id TEXT,
  guia TEXT NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  monto REAL NOT NULL,
  metodo_pago TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  cierre_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ventas_guia ON ventas(guia);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas(created_at);

CREATE TABLE IF NOT EXISTS documentos_fiscales (
  id TEXT PRIMARY KEY,
  venta_id TEXT UNIQUE REFERENCES ventas(id),
  tipo_documento TEXT NOT NULL,
  serie TEXT NOT NULL,
  numero_fiscal TEXT UNIQUE,
  estado TEXT NOT NULL,
  xml_original TEXT,
  xml_firmado TEXT,
  track_id TEXT,
  respuesta_dgii TEXT,
  codigo_qr TEXT,
  fecha_emision TEXT,
  fecha_envio TEXT,
  fecha_respuesta TEXT,
  error_tecnico TEXT,
  creado_por TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS paquetes (
  id TEXT PRIMARY KEY,
  guia TEXT UNIQUE NOT NULL,
  codigo_barras TEXT UNIQUE NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  telefono_destinatario TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  color_empaque TEXT NOT NULL,
  monto REAL NOT NULL,
  sucursal_origen TEXT NOT NULL REFERENCES sucursales(id),
  sucursal_destino TEXT NOT NULL REFERENCES sucursales(id),
  estado TEXT NOT NULL,
  documento_fiscal_id TEXT REFERENCES documentos_fiscales(id),
  created_by TEXT NOT NULL REFERENCES usuarios(id),
  created_at TEXT DEFAULT (datetime('now')),
  enviado_at TEXT,
  recibido_at TEXT,
  entregado_at TEXT,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_paquetes_guia ON paquetes(guia);
CREATE INDEX IF NOT EXISTS idx_paquetes_barcode ON paquetes(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_paquetes_estado ON paquetes(estado);
CREATE INDEX IF NOT EXISTS idx_paquetes_sucursal ON paquetes(sucursal_origen, sucursal_destino);
CREATE INDEX IF NOT EXISTS idx_paquetes_tel ON paquetes(telefono_destinatario);

CREATE TABLE IF NOT EXISTS movimientos_paquete (
  id TEXT PRIMARY KEY,
  paquete_id TEXT NOT NULL REFERENCES paquetes(id),
  estado_origen TEXT,
  estado_destino TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  detalle TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS delivery_sessions (
  id TEXT PRIMARY KEY,
  paquete_id TEXT NOT NULL REFERENCES paquetes(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  estado TEXT NOT NULL,
  validated_cedula INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS failed_delivery_attempts (
  id TEXT PRIMARY KEY,
  paquete_id TEXT NOT NULL REFERENCES paquetes(id),
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  motivo TEXT NOT NULL,
  expected_value TEXT,
  provided_value TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cierres_caja (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  total_general REAL NOT NULL,
  total_efectivo_esperado REAL NOT NULL,
  total_transferencia REAL NOT NULL,
  total_tarjeta REAL NOT NULL,
  total_otros REAL NOT NULL,
  monto_contado REAL NOT NULL,
  diferencia REAL NOT NULL,
  observacion TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cierre_ventas (
  cierre_id TEXT NOT NULL REFERENCES cierres_caja(id),
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  PRIMARY KEY (cierre_id, venta_id)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id TEXT PRIMARY KEY,
  fecha_hora TEXT NOT NULL,
  usuario_id TEXT,
  username TEXT,
  rol TEXT,
  sucursal_id TEXT,
  modulo TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  resultado TEXT NOT NULL,
  observacion TEXT,
  ip_equipo TEXT
);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_auditoria_modulo ON auditoria(modulo);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion ON auditoria(accion);

CREATE TABLE IF NOT EXISTS eventos_fiscales (
  id TEXT PRIMARY KEY,
  documento_fiscal_id TEXT REFERENCES documentos_fiscales(id),
  tipo_evento TEXT NOT NULL,
  fecha_hora TEXT NOT NULL,
  detalle TEXT,
  payload_resumen TEXT,
  resultado TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS configuracion_impresoras (
  id TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  impresora_termica TEXT,
  impresora_adhesiva TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS historial_impresion (
  id TEXT PRIMARY KEY,
  guia TEXT,
  impresora_termica TEXT,
  impresora_adhesiva TEXT,
  ticket_ok INTEGER,
  etiqueta_ok INTEGER,
  error_ticket TEXT,
  error_etiqueta TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  ref_id TEXT,
  response_payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- seed mínima
INSERT OR IGNORE INTO sucursales(id, nombre, provincia) VALUES
('suc-1','Santo Domingo Centro','Santo Domingo'),
('suc-2','Santiago Norte','Santiago');

INSERT OR IGNORE INTO secuencias_guias(id,prefijo,valor_actual) VALUES
('seq-guia-1','GUIA-',1);

INSERT OR IGNORE INTO secuencias_fiscales(id,tipo_documento,serie,secuencia_actual,secuencia_maxima,activa)
VALUES('sf-31','31','E31',500000000,599999999,1);

INSERT OR IGNORE INTO configuracion_fiscal(id,ambiente,estado_configuracion)
VALUES('cfg-fiscal-1','PREPARACION','incompleta');
