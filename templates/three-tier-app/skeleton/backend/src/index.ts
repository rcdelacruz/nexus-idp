import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { healthRoutes } from './routes/health';
import { itemRoutes } from './routes/items';
import { db } from './db/connection';

const app = express();
const port = parseInt(process.env.PORT ?? '${{ values.backendPort }}', 10);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/', healthRoutes);
app.use('/api/items', itemRoutes);

// ── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ───────────────────────────────────────────────────────────────────
async function start() {
  // Verify DB connection
  try {
    await db.raw('SELECT 1');
    logger.info('Database connected');
  } catch (err) {
    logger.error({ err }, 'Database connection failed');
    process.exit(1);
  }

  app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, `${{ values.appName }}-backend listening`);
  });
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down');
  await db.destroy();
  process.exit(0);
});
