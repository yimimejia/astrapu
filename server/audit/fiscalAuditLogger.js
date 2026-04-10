export class FiscalAuditLogger {
  constructor({ repository }) {
    this.repository = repository;
  }

  async log({ documentoFiscalId = null, tipoEvento, detalle, payloadResumen = {}, resultado = 'ok' }) {
    return this.repository.saveFiscalEvent({
      documento_fiscal_id: documentoFiscalId,
      tipo_evento: tipoEvento,
      fecha_hora: new Date().toISOString(),
      detalle,
      payload_resumen: payloadResumen,
      resultado,
    });
  }
}
