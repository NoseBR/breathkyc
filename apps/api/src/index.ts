import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';

const app = express();
const port = Number(process.env.PORT) || 3001;
const prisma = new PrismaClient();

import verificationRoutes from './routes/verification';
import documentRoutes from './routes/document';
import faceRoutes from './routes/face';
import breathRoutes from './routes/breath';
import statusRoutes from './routes/status';
import { apiKeyAuth } from './middleware/auth';

const corsOrigin = process.env.CORS_ORIGIN || true;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-breath-demo'],
  })
);
app.use(express.json());

// Apply API key auth to all verification routes
app.use('/v1/verify', apiKeyAuth);

app.use('/v1/verify', verificationRoutes);
app.use('/v1/verify/document', documentRoutes);
app.use('/v1/verify/face', faceRoutes);
app.use('/v1/verify/breath', breathRoutes);
app.use('/v1/verify/status', statusRoutes);

// Basic health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'connected',
      corsOrigin: String(corsOrigin),
      nodeEnv: process.env.NODE_ENV,
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`BreathKYC API running on http://0.0.0.0:${port}`);
});
