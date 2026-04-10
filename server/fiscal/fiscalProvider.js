/**
 * Contrato base desacoplado para proveedores fiscales.
 * NO contiene lógica de negocio de Astrapu.
 */
export class FiscalProvider {
  async configureEmitter(_config) {
    throw new Error('configureEmitter() no implementado');
  }

  async validateEmitterConfiguration(_config) {
    throw new Error('validateEmitterConfiguration() no implementado');
  }

  async authenticate() {
    throw new Error('authenticate() no implementado');
  }

  async generateXml(_fiscalPayload) {
    throw new Error('generateXml() no implementado');
  }

  async signXml(_xml) {
    throw new Error('signXml() no implementado');
  }

  async sendSignedDocument(_signedXml, _metadata) {
    throw new Error('sendSignedDocument() no implementado');
  }

  async getTrackStatus(_trackId) {
    throw new Error('getTrackStatus() no implementado');
  }

  async generateQr(_qrPayload) {
    throw new Error('generateQr() no implementado');
  }

  normalizeError(error) {
    return {
      code: 'provider_error',
      message: error?.message || 'Error de proveedor fiscal',
      raw: error,
    };
  }
}
