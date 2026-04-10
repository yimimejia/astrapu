/**
 * Mapea datos internos de Astrapu al payload fiscal.
 * Mantiene separación estricta entre guía operativa y número fiscal.
 */
export class FiscalMapper {
  mapVentaToFiscalPayload({ venta, cliente, configuracionFiscal, secuenciaFiscal }) {
    const numeroFiscal = `${secuenciaFiscal.serie}${String(secuenciaFiscal.secuencia_actual).padStart(10, '0')}`;

    return {
      referencia_negocio: venta.id,
      venta_id: venta.id,
      guia_operativa: venta.guia,
      numero_fiscal: numeroFiscal,
      tipo_documento: secuenciaFiscal.tipo_documento,
      serie: secuenciaFiscal.serie,
      rnc_emisor: configuracionFiscal.rnc,
      razon_social_emisor: configuracionFiscal.razon_social,
      ambiente: configuracionFiscal.ambiente,
      receptor: {
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        cedula: cliente.cedula || null,
      },
      monto_total: venta.monto,
      fecha_emision: new Date().toISOString(),
    };
  }
}
