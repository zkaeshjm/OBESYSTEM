import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import structureRoutes from './routes/structure.js';
import offeringRoutes from './routes/offerings.js';
import outcomeRoutes from './routes/outcomes.js';
import assessmentRoutes from './routes/assessments.js';
import attainmentRoutes from './routes/attainment.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import auditRoutes from './routes/audit.js';
import planRoutes from './routes/plans.js';
import dashboardRoutes from './routes/dashboard.js';
import materialRoutes from './routes/materials.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId(req, res) {
        const id = req.headers['x-request-id']?.toString() || crypto.randomUUID();
        res.setHeader('x-request-id', id);
        res.locals.requestId = id;
        return id;
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            remoteAddress: req.remoteAddress,
            // Authorization and cookies are deliberately never logged.
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
      customLogLevel(_req, res, error) {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    })
  );

  const allowedOrigins = env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      maxAge: 600,
    })
  );

  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => env.NODE_ENV === 'test',
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
    })
  );

  app.get('/api/v1/health', (_req, res) => {
    res.json({ data: { status: 'ok', timestamp: new Date().toISOString() } });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1', structureRoutes);
  app.use('/api/v1', offeringRoutes);
  app.use('/api/v1', outcomeRoutes);
  app.use('/api/v1', assessmentRoutes);
  app.use('/api/v1', attainmentRoutes);
  app.use('/api/v1', reportRoutes);
  app.use('/api/v1', notificationRoutes);
  app.use('/api/v1', auditRoutes);
  app.use('/api/v1', planRoutes);
  app.use('/api/v1', dashboardRoutes);
  app.use('/api/v1', materialRoutes);

  app.use('/api', notFoundHandler);

  // Production SPA hosting (the API is unchanged when served separately).
  const distDir = path.resolve('dist');
  if (env.NODE_ENV === 'production' && fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
