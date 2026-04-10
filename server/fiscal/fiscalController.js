/**
 * Controlador backend desacoplado (estilo Express/Koa).
 * No incluye credenciales sensibles en respuestas.
 */
export class FiscalController {
  constructor({ fiscalService }) {
    this.fiscalService = fiscalService;
  }

  configureEmitter = async (req, res) => {
    const data = await this.fiscalService.configureEmitter(req.body);
    res.json({ ok: true, data });
  };

  validateConfiguration = async (_req, res) => {
    const data = await this.fiscalService.validateMinimumConfiguration();
    res.json({ ok: true, data });
  };

  createDraftFromSale = async (req, res) => {
    const { venta, cliente, tipoDocumento, creadoPor } = req.body;
    const data = await this.fiscalService.buildFiscalDraft({ venta, cliente, tipoDocumento, createdBy: creadoPor });
    res.json({ ok: true, data });
  };

  generateXml = async (req, res) => {
    const data = await this.fiscalService.generateXml(req.params.documentId);
    res.json({ ok: true, data });
  };

  signDocument = async (req, res) => {
    const data = await this.fiscalService.signDocument(req.params.documentId);
    res.json({ ok: true, data });
  };

  sendDocument = async (req, res) => {
    const data = await this.fiscalService.sendToDgii(req.params.documentId);
    res.json({ ok: true, data });
  };

  queryTrack = async (req, res) => {
    const data = await this.fiscalService.refreshTrackStatus(req.params.trackId);
    res.json({ ok: true, data });
  };

  retry = async (req, res) => {
    const data = await this.fiscalService.controlledRetry(req.params.documentId);
    res.json({ ok: true, data });
  };

  printableRepresentation = async (req, res) => {
    const data = await this.fiscalService.buildPrintableRepresentation(req.params.documentId);
    res.json({ ok: true, data });
  };
}
