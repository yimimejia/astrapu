import { rateLimit } from 'express-rate-limit';

function standardHandler(_req, res) {
  res.status(429).json({
    ok: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Demasiadas solicitudes, intenta nuevamente más tarde',
    },
  });
}

function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: standardHandler,
  });
}

export const loginLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
export const logoutLimiter = createLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

export const opsSearchLimiter = createLimiter({ windowMs: 60 * 1000, max: 300 });
export const opsScanLimiter = createLimiter({ windowMs: 60 * 1000, max: 600 });
export const opsCloseLimiter = createLimiter({ windowMs: 60 * 1000, max: 30 });
export const opsMutationLimiter = createLimiter({ windowMs: 60 * 1000, max: 120 });
export const opsReadLimiter = createLimiter({ windowMs: 60 * 1000, max: 180 });

export const printLimiter = createLimiter({ windowMs: 60 * 1000, max: 60 });
export const fiscalLimiter = createLimiter({ windowMs: 60 * 1000, max: 30 });
