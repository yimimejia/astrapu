import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { authRoutes } from './routes/authRoutes.js';
import { opsRoutes } from './routes/opsRoutes.js';
import { auditRoutes } from './routes/auditRoutes.js';
import { printRoutes } from './routes/printRoutes.js';
import { fiscalRoutes } from './routes/fiscalRoutes.js';
import { sendError } from './lib/http.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'astrapu-api', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/ops', opsRoutes);
  app.use('/api/auditoria', auditRoutes);
  app.use('/api/impresion', printRoutes);
  app.use('/api/fiscal', fiscalRoutes);

  app.use(express.static(rootDir));

  app.get('*', (_req, res) => {
    res.sendFile(join(rootDir, 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Error interno del servidor');
  });

  return app;
}
