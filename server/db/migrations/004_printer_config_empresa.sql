ALTER TABLE configuracion_impresoras ADD COLUMN nombre_empresa TEXT NOT NULL DEFAULT 'ASTRAPU';
ALTER TABLE configuracion_impresoras ADD COLUMN subtitulo TEXT NOT NULL DEFAULT 'Paquetería Interprovincial RD';
ALTER TABLE configuracion_impresoras ADD COLUMN telefono_empresa TEXT NOT NULL DEFAULT '';
ALTER TABLE configuracion_impresoras ADD COLUMN rnc TEXT NOT NULL DEFAULT '';
ALTER TABLE configuracion_impresoras ADD COLUMN mensaje_final TEXT NOT NULL DEFAULT 'Gracias por preferirnos';
