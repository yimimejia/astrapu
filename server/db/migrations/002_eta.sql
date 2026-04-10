CREATE TABLE IF NOT EXISTS route_eta_samples (
  id TEXT PRIMARY KEY,
  sucursal_origen_id TEXT NOT NULL,
  sucursal_destino_id TEXT NOT NULL,
  paquete_id TEXT NOT NULL UNIQUE,
  fecha_salida TEXT,
  fecha_llegada TEXT,
  duracion_minutos REAL,
  dia_semana INTEGER,
  franja_horaria TEXT,
  volumen_ruta_dia INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS route_eta_stats (
  id TEXT PRIMARY KEY,
  sucursal_origen_id TEXT NOT NULL,
  sucursal_destino_id TEXT NOT NULL,
  muestras_totales INTEGER DEFAULT 0,
  muestras_dias_unicos INTEGER DEFAULT 0,
  promedio_general_minutos REAL,
  promedio_por_dia_json TEXT DEFAULT '{}',
  promedio_por_franja_json TEXT DEFAULT '{}',
  fecha_primera_muestra TEXT,
  fecha_ultima_actualizacion TEXT,
  estado_modelo TEXT DEFAULT 'aprendiendo',
  confianza REAL DEFAULT 0,
  UNIQUE(sucursal_origen_id, sucursal_destino_id)
);

CREATE TABLE IF NOT EXISTS route_eta_recommendations (
  id TEXT PRIMARY KEY,
  tipo TEXT DEFAULT 'general',
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  datos_json TEXT DEFAULT '{}',
  estado TEXT DEFAULT 'pendiente',
  semana TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  aceptada_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_eta_samples_ruta ON route_eta_samples(sucursal_origen_id, sucursal_destino_id);
CREATE INDEX IF NOT EXISTS idx_eta_samples_paquete ON route_eta_samples(paquete_id);
CREATE INDEX IF NOT EXISTS idx_eta_recs_estado ON route_eta_recommendations(estado);
