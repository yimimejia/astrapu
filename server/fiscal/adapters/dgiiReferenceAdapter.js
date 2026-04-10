import { FiscalProvider } from '../fiscalProvider.js';

/**
 * Adapter de referencia conceptual DGII.
 * Usa patrón inspirado en dgii-ecf:
 * - authenticate() => seed + firma + token
 * - sendSignedDocument() => envio + trackId
 * - getTrackStatus(trackId)
 *
 * Importante: no amarra el negocio a dgii-ecf. El import es opcional.
 */
export class DgiiReferenceAdapter extends FiscalProvider {
  constructor({ environment = 'TESTECF', certificateResolver, logger }) {
    super();
    this.environment = environment;
    this.certificateResolver = certificateResolver;
    this.logger = logger;
    this.runtime = null;
    this.token = null;
  }

  async loadRuntime() {
    if (this.runtime) return this.runtime;

    try {
      // import opcional, para evitar dependencia rígida
      this.runtime = await import('dgii-ecf');
      this.logger?.info?.('dgii-ecf disponible en runtime');
    } catch {
      this.runtime = null;
      this.logger?.warn?.('dgii-ecf no instalado; se usa modo referencia/mock');
    }
    return this.runtime;
  }

  async configureEmitter(config) {
    return {
      ok: true,
      environment: config.ambiente,
      rnc: config.rnc,
      message: 'Configuración de emisor validada para adapter de referencia DGII.',
    };
  }

  async validateEmitterConfiguration(config) {
    const required = ['rnc', 'razon_social', 'ambiente', 'certificado_ref'];
    const missing = required.filter((f) => !config?.[f]);
    return {
      valid: missing.length === 0,
      missing,
    };
  }

  async authenticate() {
    const runtime = await this.loadRuntime();
    // Concepto DGII: seed + firma + token.
    if (!runtime) {
      this.token = {
        access_token: 'mock_token_preparacion',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
      return this.token;
    }

    // Si se instala dgii-ecf en backend, aquí se implementa autenticación real.
    // const cert = await this.certificateResolver.getCertificate();
    // const ecf = new runtime.default(cert, runtime.ENVIRONMENT.DEV);
    // this.token = await ecf.authenticate();
    // return this.token;

    this.token = {
      access_token: 'pending_real_auth',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    return this.token;
  }

  async generateXml(fiscalPayload) {
    // XML base desacoplado: puede reemplazarse por otro proveedor
    return `<?xml version="1.0" encoding="UTF-8"?><ECF><Encabezado><RNCEmisor>${fiscalPayload.rnc_emisor}</RNCEmisor><eNCF>${fiscalPayload.numero_fiscal}</eNCF></Encabezado><Totales><MontoTotal>${fiscalPayload.monto_total}</MontoTotal></Totales></ECF>`;
  }

  async signXml(xml) {
    const cert = await this.certificateResolver.getCertificateMetadata();
    return {
      signedXml: `${xml}<!-- SignedBy:${cert.subject || 'CERT_PREPARACION'} -->`,
      signatureMeta: {
        algorithm: 'XAdES-BES',
        signedAt: new Date().toISOString(),
      },
    };
  }

  async sendSignedDocument(_signedXml, metadata) {
    return {
      accepted: true,
      trackId: `TRK-${Date.now()}`,
      rawResponse: {
        codigo: '100',
        estado: 'en_proceso',
        numero_fiscal: metadata.numero_fiscal,
      },
    };
  }

  async getTrackStatus(trackId) {
    return {
      trackId,
      estado: 'en_proceso',
      codigo: '100',
      mensajes: [{ codigo: 0, valor: 'Procesando en DGII (modo referencia)' }],
    };
  }

  async generateQr(qrPayload) {
    const params = new URLSearchParams({
      rnc: qrPayload.rnc,
      encf: qrPayload.numero_fiscal,
      monto: String(qrPayload.monto_total),
      fecha: qrPayload.fecha_emision,
    });
    return `https://ecf.dgii.gov.do/consulta?${params.toString()}`;
  }
}
