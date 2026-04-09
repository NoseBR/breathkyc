import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Cache validated keys for 5 minutes to avoid repeated DB + bcrypt lookups
const keyCache = new Map<string, { clientId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  // Allow demo bypass for the frontend verification flow
  const demoHeader = req.headers['x-breath-demo'];
  if (demoHeader === 'true') {
    return next();
  }

  const apiKey = req.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Provide a valid API key via the x-api-key header.'
    });
  }

  // Check cache first
  const cached = keyCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    (req as any).clientId = cached.clientId;
    return next();
  }

  try {
    // Extract prefix for fast lookup (bk_live_XXXXXXXX -> first 16 chars)
    const prefix = apiKey.substring(0, 16);

    // Find matching key records by prefix
    const candidates = await prisma.apiKey.findMany({
      where: { prefix, isActive: true },
      include: { client: true }
    });

    if (candidates.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Verify against bcrypt hash
    for (const candidate of candidates) {
      const isValid = await bcrypt.compare(apiKey, candidate.keyHash);
      if (isValid) {
        if (!candidate.client.isActive) {
          return res.status(403).json({ error: 'Client account is deactivated' });
        }

        // Update lastUsed timestamp (fire and forget)
        prisma.apiKey.update({
          where: { id: candidate.id },
          data: { lastUsed: new Date() }
        }).catch(() => {}); // Non-blocking

        // Cache the validated key
        keyCache.set(apiKey, {
          clientId: candidate.clientId,
          expiresAt: Date.now() + CACHE_TTL_MS
        });

        (req as any).clientId = candidate.clientId;
        return next();
      }
    }

    return res.status(401).json({ error: 'Invalid API key' });

  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication service error' });
  }
}
