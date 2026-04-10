import { FiscalRepository } from './fiscalRepository.js';
import { FiscalMapper } from './fiscalMapper.js';
import { FiscalService } from './fiscalService.js';
import { FiscalController } from './fiscalController.js';
import { DgiiReferenceAdapter } from './adapters/dgiiReferenceAdapter.js';
import { FiscalAuditLogger } from '../audit/fiscalAuditLogger.js';
import { certificateResolver } from '../config/fiscalConfig.js';

export function buildFiscalModule({ db, logger = console }) {
  const repository = new FiscalRepository({ db });
  const mapper = new FiscalMapper();
  const provider = new DgiiReferenceAdapter({
    environment: db.configuracion_fiscal?.ambiente || 'PREPARACION',
    certificateResolver,
    logger,
  });
  const auditLogger = new FiscalAuditLogger({ repository });
  const service = new FiscalService({ repository, provider, mapper, auditLogger });
  const controller = new FiscalController({ fiscalService: service });

  return { repository, mapper, provider, service, controller };
}
