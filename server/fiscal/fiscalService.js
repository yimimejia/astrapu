const STATES = {
  BORRADOR: 'borrador',
  LISTO_PARA_FIRMAR: 'listo_para_firmar',
  FIRMADO: 'firmado',
  ENVIADO: 'enviado',
  EN_PROCESO: 'en_proceso',
  ACEPTADO: 'aceptado',
  ACEPTADO_CONDICIONAL: 'aceptado_condicional',
  RECHAZADO: 'rechazado',
  ANULADO: 'anulado',
  ERROR_TECNICO: 'error_tecnico',
};

export class FiscalService {
  constructor({ repository, provider, mapper, auditLogger }) {
    this.repository = repository;
    this.provider = provider;
    this.mapper = mapper;
    this.audit = auditLogger;
  }

  getStates() {
    return STATES;
  }

  async configureEmitter(configPayload) {
    const config = await this.repository.updateFiscalConfig(configPayload);
    await this.audit.log({ tipoEvento: 'configuracion_fiscal_actualizada', detalle: 'Configuración fiscal guardada', payloadResumen: { ambiente: config.ambiente, rnc: config.rnc } });
    return config;
  }

  async validateMinimumConfiguration() {
    const cfg = await this.repository.getFiscalConfig();
    const result = await this.provider.validateEmitterConfiguration(cfg);
    await this.audit.log({ tipoEvento: 'validacion_configuracion', detalle: result.valid ? 'Configuración válida' : 'Configuración incompleta', payloadResumen: result, resultado: result.valid ? 'ok' : 'error' });
    return result;
  }

  async buildFiscalDraft({ venta, cliente, tipoDocumento, createdBy }) {
    const sequence = await this.repository.getActiveSequence(tipoDocumento);
    const config = await this.repository.getFiscalConfig();
    const payload = this.mapper.mapVentaToFiscalPayload({ venta, cliente, configuracionFiscal: config, secuenciaFiscal: sequence });

    const doc = await this.repository.saveFiscalDocument({
      venta_id: venta.id,
      tipo_documento: tipoDocumento,
      serie: sequence.serie,
      numero_fiscal: payload.numero_fiscal,
      estado: STATES.BORRADOR,
      xml_original: null,
      xml_firmado: null,
      track_id: null,
      respuesta_dgii: null,
      codigo_qr: null,
      fecha_emision: payload.fecha_emision,
      fecha_envio: null,
      fecha_respuesta: null,
      error_tecnico: null,
      creado_por: createdBy,
      payload,
      reintentos: 0,
    });

    await this.repository.consumeSequence(sequence.id);
    await this.audit.log({ documentoFiscalId: doc.id, tipoEvento: 'documento_borrador_creado', detalle: 'Borrador fiscal generado', payloadResumen: { numero_fiscal: doc.numero_fiscal, venta_id: doc.venta_id } });
    return doc;
  }

  async generateXml(documentId) {
    const doc = await this.repository.getFiscalDocumentById(documentId);
    const xml = await this.provider.generateXml(doc.payload);
    const updated = await this.repository.updateFiscalDocument(documentId, { estado: STATES.LISTO_PARA_FIRMAR, xml_original: xml });
    await this.audit.log({ documentoFiscalId: documentId, tipoEvento: 'xml_generado', detalle: 'XML fiscal generado', payloadResumen: { estado: updated.estado } });
    return updated;
  }

  async signDocument(documentId) {
    const doc = await this.repository.getFiscalDocumentById(documentId);
    const signResult = await this.provider.signXml(doc.xml_original);
    const updated = await this.repository.updateFiscalDocument(documentId, {
      estado: STATES.FIRMADO,
      xml_firmado: signResult.signedXml,
      firma_meta: signResult.signatureMeta,
    });
    await this.audit.log({ documentoFiscalId: documentId, tipoEvento: 'xml_firmado', detalle: 'Documento fiscal firmado', payloadResumen: signResult.signatureMeta });
    return updated;
  }

  async sendToDgii(documentId) {
    const doc = await this.repository.getFiscalDocumentById(documentId);
    await this.provider.authenticate();
    const send = await this.provider.sendSignedDocument(doc.xml_firmado, {
      numero_fiscal: doc.numero_fiscal,
      tipo_documento: doc.tipo_documento,
    });

    const qr = await this.provider.generateQr({
      rnc: doc.payload.rnc_emisor,
      numero_fiscal: doc.numero_fiscal,
      monto_total: doc.payload.monto_total,
      fecha_emision: doc.fecha_emision,
    });

    const updated = await this.repository.updateFiscalDocument(documentId, {
      estado: send.accepted ? STATES.EN_PROCESO : STATES.ERROR_TECNICO,
      track_id: send.trackId || null,
      respuesta_dgii: send.rawResponse,
      codigo_qr: qr,
      fecha_envio: new Date().toISOString(),
      error_tecnico: send.accepted ? null : send.rawResponse,
    });

    await this.audit.log({ documentoFiscalId: documentId, tipoEvento: 'documento_enviado_dgii', detalle: 'Documento enviado a DGII', payloadResumen: { track_id: updated.track_id, estado: updated.estado }, resultado: send.accepted ? 'ok' : 'error' });
    return updated;
  }

  async refreshTrackStatus(trackId) {
    const status = await this.provider.getTrackStatus(trackId);
    const doc = await this.repository.getFiscalDocumentByTrackId(trackId);

    const statusMap = {
      Aceptado: STATES.ACEPTADO,
      AceptadoCondicional: STATES.ACEPTADO_CONDICIONAL,
      Rechazado: STATES.RECHAZADO,
    };

    const newState = statusMap[status.estado] || STATES.EN_PROCESO;
    const updated = await this.repository.updateFiscalDocument(doc.id, {
      estado: newState,
      fecha_respuesta: new Date().toISOString(),
      respuesta_dgii: status,
    });

    await this.audit.log({ documentoFiscalId: doc.id, tipoEvento: 'consulta_trackid', detalle: 'Estado consultado por trackId', payloadResumen: { track_id: trackId, estado: newState } });
    return updated;
  }

  async controlledRetry(documentId) {
    const doc = await this.repository.getFiscalDocumentById(documentId);
    if (doc.reintentos >= 3) {
      await this.audit.log({ documentoFiscalId: documentId, tipoEvento: 'reintento_bloqueado', detalle: 'Máximo de reintentos alcanzado', payloadResumen: { reintentos: doc.reintentos }, resultado: 'error' });
      throw new Error('Máximo de reintentos alcanzado');
    }

    const patch = await this.repository.updateFiscalDocument(documentId, {
      reintentos: doc.reintentos + 1,
      estado: STATES.ENVIADO,
    });

    await this.audit.log({ documentoFiscalId: documentId, tipoEvento: 'reintento_envio', detalle: 'Reintento controlado de envío fiscal', payloadResumen: { reintentos: patch.reintentos } });
    return this.sendToDgii(documentId);
  }

  async buildPrintableRepresentation(documentId) {
    const doc = await this.repository.getFiscalDocumentById(documentId);
    const representation = {
      titulo: 'Representación impresa e-CF',
      numero_fiscal: doc.numero_fiscal,
      fecha_emision: doc.fecha_emision,
      monto_total: doc.payload.monto_total,
      qr: doc.codigo_qr,
      estado: doc.estado,
    };
    await this.audit.log({ documentoFiscalId: documentId, tipoEvento: 'representacion_impresa_generada', detalle: 'Representación fiscal preparada', payloadResumen: { numero_fiscal: doc.numero_fiscal } });
    return representation;
  }
}
