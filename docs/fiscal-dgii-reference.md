# Referencia técnica: `dgii-ecf` (análisis conceptual)

Fuente revisada: repositorio público `victors1681/dgii-ecf`.

## Métodos/piezas observadas
- Clases principales: `ECF`, `P12Reader`, `Signature`.
- Flujo de autenticación: semilla + firma de semilla + token.
- Envío: `sendElectronicDocument(signedXml, fileName)`.
- Consulta: `statusTrackId(trackId)`, `trackStatuses`, `inquiryStatus`.
- Utilidades: transformación JSON->XML, validación de certificado XML, generación de QR, conversiones RFCE.

## Datos requeridos recurrentes
- RNC emisor, e-NCF, tipo de documento, montos, receptor.
- Certificado digital (`.p12`) y passphrase (solo backend).
- Ambiente (`TesteCF`, `CerteCF`, `eCF`).
- TrackId y respuestas DGII.

## Qué se replica conceptualmente en Astrapu
- Provider interface desacoplada.
- Adapter DGII de referencia con métodos homologables:
  - authenticate
  - generateXml
  - signXml
  - sendSignedDocument
  - getTrackStatus
  - generateQr
- State machine interna fiscal.
- Registro de eventos fiscales y auditoría por transición.

## Qué NO se copia literalmente
- Dependencia rígida del core de negocio a `dgii-ecf`.
- Exposición de certificados/firmas en frontend.
- Acoplamiento de guía logística con numeración fiscal.
- Diseño de integración monolítica sin repositorio/controlador/mapper separados.

## Notas
- En Astrapu, `dgii-ecf` queda encapsulada opcionalmente en `server/fiscal/adapters/dgiiReferenceAdapter.js`.
- Si no está instalada, el adapter opera en modo referencia/preparación sin romper la arquitectura.
