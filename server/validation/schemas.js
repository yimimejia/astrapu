import { z } from 'zod';

const nonEmpty = (field) => z.string().trim().min(1, `${field} es requerido`);

export const loginSchema = z.object({
  username: nonEmpty('username'),
  password: nonEmpty('password').min(6, 'password debe tener al menos 6 caracteres'),
});

export const registerEnvioSchema = z.object({
  telefono: z.string().trim().min(7, 'telefono inválido').max(20),
  nombre: nonEmpty('nombre'),
  cedula: z.string().trim().min(5, 'cedula inválida').max(20).optional().or(z.literal('')),
  direccion: z.string().trim().max(250).optional().or(z.literal('')),
  descripcion: nonEmpty('descripcion').max(250),
  color_empaque: nonEmpty('color_empaque').max(50),
  monto: z.coerce.number().nonnegative('monto debe ser >= 0'),
  sucursal_origen: nonEmpty('sucursal_origen'),
  sucursal_destino: nonEmpty('sucursal_destino'),
  metodo_pago: z.enum(['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO']).optional(),
});

export const scanSchema = z.object({
  code: nonEmpty('code').max(120),
});

export const startDeliverySchema = z.object({
  paquete_id: nonEmpty('paquete_id'),
  cedula: nonEmpty('cedula'),
});

export const confirmDeliverySchema = z.object({
  session_id: nonEmpty('session_id'),
  scanned_code: nonEmpty('scanned_code').max(120),
});

export const closeCashSchema = z.object({
  monto_contado: z.coerce.number().nonnegative('monto_contado debe ser >= 0'),
  observacion: z.string().trim().max(300).optional().or(z.literal('')),
});

export const printerConfigSchema = z.object({
  impresora_termica: nonEmpty('impresora_termica').max(120),
  impresora_adhesiva: nonEmpty('impresora_adhesiva').max(120),
});

export const qzSignSchema = z.object({
  payload: nonEmpty('payload').max(20000),
});

export const fiscalConfigSchema = z.object({
  rnc: nonEmpty('rnc').max(20),
  razon_social: nonEmpty('razon_social').max(150),
  ambiente: z.enum(['CERTIFICACION', 'PRODUCCION']).default('CERTIFICACION'),
});

export const fiscalDraftSchema = z.object({
  venta_id: nonEmpty('venta_id'),
  tipo_ncf: z.enum(['B01', 'B02', 'B14', 'B15']),
});

export const fiscalTrackParamsSchema = z.object({
  trackId: nonEmpty('trackId'),
});

export const fiscalDocumentParamsSchema = z.object({
  documentId: nonEmpty('documentId'),
});

export const clienteCreateSchema = z.object({
  telefono: z.string().trim().min(7, 'teléfono inválido').max(20),
  nombre: nonEmpty('nombre').max(100),
  cedula: z.string().trim().max(20).optional().or(z.literal('')),
  direccion: z.string().trim().max(250).optional().or(z.literal('')),
});

export const clienteUpdateSchema = clienteCreateSchema.partial();

export const sucursalSchema = z.object({
  nombre: nonEmpty('nombre').max(100),
  provincia: nonEmpty('provincia').max(100),
});

export const usuarioCreateSchema = z.object({
  username: nonEmpty('username').max(50),
  nombre: nonEmpty('nombre').max(100),
  password: z.string().min(6, 'contraseña mínima 6 caracteres').max(100),
  rol: z.enum(['admin', 'envios', 'entrega', 'contable']),
  sucursal_id: nonEmpty('sucursal_id'),
});

export const usuarioUpdateSchema = z.object({
  nombre: nonEmpty('nombre').max(100).optional(),
  password: z.string().min(6).max(100).optional(),
  rol: z.enum(['admin', 'envios', 'entrega', 'contable']).optional(),
  sucursal_id: nonEmpty('sucursal_id').optional(),
});

export const configGeneralSchema = z.object({
  nombre_empresa: nonEmpty('nombre_empresa').max(100),
  rnc_empresa: z.string().trim().max(20).optional().or(z.literal('')),
  telefono_empresa: z.string().trim().max(20).optional().or(z.literal('')),
  direccion_empresa: z.string().trim().max(250).optional().or(z.literal('')),
});
