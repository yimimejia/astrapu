export function sendError(res, status, code, message, details = undefined) {
  return res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}

export function sendOk(res, data = {}, status = 200) {
  return res.status(status).json({ ok: true, data });
}
