import { sendError } from '../lib/http.js';

function zodIssuesToDetails(issues) {
  return issues.map((issue) => ({
    path: issue.path.join('.') || 'body',
    message: issue.message,
    code: issue.code,
  }));
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Payload inválido', zodIssuesToDetails(result.error.issues));
    }
    req.body = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params ?? {});
    if (!result.success) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Parámetros inválidos', zodIssuesToDetails(result.error.issues));
    }
    req.params = result.data;
    return next();
  };
}
