import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { decrypt } from '../lib/crypto';

const router = Router();
const prisma = new PrismaClient();

// GET /v1/verify/status/:sessionId — B2B poll endpoint
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const verification = await prisma.verification.findUnique({
      where: { sessionId }
    });

    if (!verification) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const safeDecrypt = (val: string | null) => {
      if (!val) return null;
      try {
        // If it looks like JSON already (from Phase A legacy), parse it directly
        // Otherwise decrypt then parse.
        if (val.startsWith('{')) return JSON.parse(val);
        return JSON.parse(decrypt(val));
      } catch (e) {
        console.error('Decryption failed for field:', e);
        return null;
      }
    };

    // Parse stored JSON fields (Decrypted in Phase B)
    const result = {
      sessionId: verification.sessionId,
      status: verification.status,
      createdAt: verification.createdAt,
      expiresAt: verification.expiresAt,
      geoResult: verification.geoResult ? JSON.parse(verification.geoResult) : null,
      documentResult: safeDecrypt(verification.documentResult),
      faceResult: safeDecrypt(verification.faceResult),
      breathResult: safeDecrypt(verification.breathResult),
    };

    res.json(result);

  } catch (error) {
    console.error('Status fetch error:', error);
    res.status(500).json({ status: 'error', message: 'Failed to fetch verification status' });
  }
});

export default router;
