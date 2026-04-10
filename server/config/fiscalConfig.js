export function loadFiscalEnvConfig() {
  return {
    appFiscalEnabled: process.env.FISCAL_ENABLED === 'true',
    ambiente: process.env.FISCAL_ENVIRONMENT || 'PREPARACION',
    certificadoRef: process.env.FISCAL_CERT_REF || '',
    certificadoPasswordRef: process.env.FISCAL_CERT_PASSWORD_REF || '',
    dgiiBaseUrl: process.env.DGII_BASE_URL || '',
    signerEndpoint: process.env.QZ_SIGNER_ENDPOINT || '',
  };
}

export function assertNoSensitiveClientLeak() {
  const forbidden = ['FISCAL_CERT_PASSWORD', 'PRIVATE_KEY', 'P12_PASSWORD'];
  const leaked = forbidden.filter((name) => process.env[name]);
  if (leaked.length) {
    throw new Error(`Variables sensibles mal ubicadas en entorno de app: ${leaked.join(', ')}`);
  }
}

export const certificateResolver = {
  async getCertificateMetadata() {
    return {
      subject: process.env.FISCAL_CERT_SUBJECT || 'CERT_PREPARACION',
      source: process.env.FISCAL_CERT_REF || 'NO_CONFIG',
    };
  },
};
