-- Astrapu schema base (multi-sucursal, audit-ready)
CREATE TABLE sucursales (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  provincia TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clientes (
  id TEXT PRIMARY KEY,
  telefono TEXT NOT NULL UNIQUE,
  cedula TEXT,
  nombre TEXT NOT NULL,
  direccion TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_clientes_telefono ON clientes(telefono);
CREATE INDEX idx_clientes_cedula ON clientes(cedula);

CREATE TABLE secuencias_guias (
  id TEXT PRIMARY KEY,
  prefijo TEXT NOT NULL,
  valor_actual BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE secuencias_fiscales (
  id TEXT PRIMARY KEY,
  tipo_documento TEXT NOT NULL,
  serie TEXT NOT NULL,
  secuencia_actual BIGINT NOT NULL,
  secuencia_maxima BIGINT,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_sec_fiscal_tipo ON secuencias_fiscales(tipo_documento, activa);

CREATE TABLE configuracion_fiscal (
  id TEXT PRIMARY KEY,
  rnc TEXT,
  razon_social TEXT,
  nombre_comercial TEXT,
  direccion_fiscal TEXT,
  correo_fiscal TEXT,
  ambiente TEXT,
  certificado_ref TEXT,
  certificado_password_ref TEXT,
  secuencias JSON,
  estado_configuracion TEXT,
  parametros JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE ventas (
  id TEXT PRIMARY KEY,
  paquete_id TEXT,
  guia TEXT NOT NULL,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  monto NUMERIC(12,2) NOT NULL,
  metodo_pago TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  cierre_id TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ventas_guia ON ventas(guia);
CREATE INDEX idx_ventas_fecha ON ventas(created_at);

CREATE TABLE documentos_fiscales (
  id TEXT PRIMARY KEY,
  venta_id TEXT UNIQUE REFERENCES ventas(id),
  tipo_documento TEXT NOT NULL,
  serie TEXT NOT NULL,
  numero_fiscal TEXT UNIQUE,
  estado TEXT NOT NULL,
  xml_original TEXT,
  xml_firmado TEXT,
  track_id TEXT,
  respuesta_dgii JSON,
  codigo_qr TEXT,
  fecha_emision TIMESTAMP,
  fecha_envio TIMESTAMP,
  fecha_respuesta TIMESTAMP,
  error_tecnico TEXT,
  creado_por TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);
CREATE INDEX idx_doc_fiscal_numero ON documentos_fiscales(numero_fiscal);
CREATE INDEX idx_doc_fiscal_track ON documentos_fiscales(track_id);
CREATE INDEX idx_doc_fiscal_estado ON documentos_fiscales(estado);

CREATE TABLE paquetes (
  id TEXT PRIMARY KEY,
  guia TEXT NOT NULL UNIQUE,
  codigo_barras TEXT NOT NULL UNIQUE,
  cliente_id TEXT NOT NULL REFERENCES clientes(id),
  telefono_destinatario TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  color_empaque TEXT NOT NULL,
  monto NUMERIC(12,2) NOT NULL,
  sucursal_origen TEXT NOT NULL REFERENCES sucursales(id),
  sucursal_destino TEXT NOT NULL REFERENCES sucursales(id),
  estado TEXT NOT NULL,
  documento_fiscal_id TEXT NULL REFERENCES documentos_fiscales(id),
  created_by TEXT NOT NULL REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  enviado_at TIMESTAMP,
  recibido_at TIMESTAMP,
  entregado_at TIMESTAMP
);
CREATE INDEX idx_paquetes_guia ON paquetes(guia);
CREATE INDEX idx_paquetes_barcode ON paquetes(codigo_barras);
CREATE INDEX idx_paquetes_estado ON paquetes(estado);
CREATE INDEX idx_paquetes_sucursal ON paquetes(sucursal_origen, sucursal_destino);
CREATE INDEX idx_paquetes_fecha ON paquetes(created_at);
CREATE INDEX idx_paquetes_tel ON paquetes(telefono_destinatario);

CREATE TABLE movimientos_paquete (
  id TEXT PRIMARY KEY,
  paquete_id TEXT NOT NULL REFERENCES paquetes(id),
  estado_origen TEXT,
  estado_destino TEXT NOT NULL,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  detalle TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cierres_caja (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  total_general NUMERIC(12,2) NOT NULL,
  total_efectivo_esperado NUMERIC(12,2) NOT NULL,
  total_transferencia NUMERIC(12,2) NOT NULL,
  total_tarjeta NUMERIC(12,2) NOT NULL,
  total_otros NUMERIC(12,2) NOT NULL,
  monto_contado NUMERIC(12,2) NOT NULL,
  diferencia NUMERIC(12,2) NOT NULL,
  observacion TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cierre_ventas (
  cierre_id TEXT NOT NULL REFERENCES cierres_caja(id),
  venta_id TEXT NOT NULL REFERENCES ventas(id),
  PRIMARY KEY (cierre_id, venta_id)
);

CREATE TABLE auditoria (
  id TEXT PRIMARY KEY,
  fecha_hora TIMESTAMP NOT NULL,
  usuario_id TEXT,
  rol TEXT NOT NULL,
  sucursal_id TEXT,
  modulo TEXT NOT NULL,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidad_id TEXT NOT NULL,
  valor_anterior JSON,
  valor_nuevo JSON,
  resultado TEXT NOT NULL,
  observacion TEXT,
  ip_equipo TEXT
);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha_hora);
CREATE INDEX idx_auditoria_modulo ON auditoria(modulo);
CREATE INDEX idx_auditoria_accion ON auditoria(accion);

CREATE TABLE eventos_fiscales (
  id TEXT PRIMARY KEY,
  documento_fiscal_id TEXT REFERENCES documentos_fiscales(id),
  tipo_evento TEXT NOT NULL,
  fecha_hora TIMESTAMP NOT NULL,
  detalle TEXT,
  payload_resumen JSON,
  resultado TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_eventos_fiscales_doc ON eventos_fiscales(documento_fiscal_id);
CREATE INDEX idx_eventos_fiscales_tipo ON eventos_fiscales(tipo_evento);

CREATE TABLE configuracion_impresoras (
  id TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL REFERENCES sucursales(id),
  impresora_termica TEXT,
  impresora_adhesiva TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE historial_impresion (
  id TEXT PRIMARY KEY,
  guia TEXT,
  impresora_termica TEXT,
  impresora_adhesiva TEXT,
  ticket_ok BOOLEAN,
  etiqueta_ok BOOLEAN,
  error_ticket TEXT,
  error_etiqueta TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
