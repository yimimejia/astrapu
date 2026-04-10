/**
 * Repositorio fiscal desacoplado.
 * Actualmente in-memory para la demo, preparado para reemplazar por DB real.
 */
export class FiscalRepository {
  constructor({ db }) {
    this.db = db;
  }

  async getFiscalConfig() {
    return this.db.configuracion_fiscal;
  }

  async updateFiscalConfig(payload) {
    this.db.configuracion_fiscal = {
      ...this.db.configuracion_fiscal,
      ...payload,
      updated_at: new Date().toISOString(),
    };
    return this.db.configuracion_fiscal;
  }

  async getActiveSequence(tipoDocumento) {
    const seq = this.db.secuencias_fiscales.find((s) => s.tipo_documento === tipoDocumento && s.activa);
    if (!seq) throw new Error(`No hay secuencia fiscal activa para tipo ${tipoDocumento}`);
    return seq;
  }

  async consumeSequence(sequenceId) {
    const seq = this.db.secuencias_fiscales.find((s) => s.id === sequenceId);
    seq.secuencia_actual += 1;
    return seq;
  }

  async saveFiscalDocument(doc) {
    const created = {
      id: `df-${this.db.documentos_fiscales.length + 1}`,
      ...doc,
      created_at: new Date().toISOString(),
    };
    this.db.documentos_fiscales.unshift(created);
    return created;
  }

  async updateFiscalDocument(documentId, patch) {
    const target = this.db.documentos_fiscales.find((d) => d.id === documentId);
    Object.assign(target, patch, { updated_at: new Date().toISOString() });
    return target;
  }

  async getFiscalDocumentById(documentId) {
    return this.db.documentos_fiscales.find((d) => d.id === documentId);
  }

  async getFiscalDocumentByTrackId(trackId) {
    return this.db.documentos_fiscales.find((d) => d.track_id === trackId);
  }

  async saveFiscalEvent(event) {
    const created = {
      id: `ef-${this.db.eventos_fiscales.length + 1}`,
      ...event,
    };
    this.db.eventos_fiscales.unshift(created);
    return created;
  }

  async listFiscalDocuments() {
    return this.db.documentos_fiscales;
  }
}
