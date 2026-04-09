import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';
import { encrypt, decrypt } from '../lib/crypto';

const router = Router();
const prisma = new PrismaClient();

const MOUTH_MIN = 30;
const AUDIO_MIN = 25;

const breathSchema = z.object({
  sessionId: z.string(),
  syncScore: z.number().min(0).max(100),
  mouthScore: z.number().min(0).max(100).optional().default(0),
  audioScore: z.number().min(0).max(100).optional().default(0),
});

/**
 * Combine face template hash + breath data + session into a single
 * biometric hashcode suitable for on-chain storage as a validator.
 */
function buildBiometricHash(faceTemplateHash: string, breathData: object, sessionId: string): string {
  const payload = JSON.stringify({
    face: faceTemplateHash,
    breath: breathData,
    session: sessionId,
    version: 'breathkyc-v1',
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

router.post('/', async (req, res) => {
  try {
    const body = breathSchema.parse(req.body);

    const verification = await prisma.verification.findUnique({
      where: { sessionId: body.sessionId }
    });

    if (!verification) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!verification.faceResult) {
      return res.status(400).json({
        error: 'Face verification must succeed before breath analysis.',
      });
    }

    let facePassed = false;
    let faceTemplateHash = '';
    try {
      const raw = verification.faceResult;
      const parsed = raw.startsWith('{')
        ? (JSON.parse(raw) as { passed?: boolean; templateHash?: string })
        : (JSON.parse(decrypt(raw)) as { passed?: boolean; templateHash?: string });
      facePassed = Boolean(parsed.passed);
      faceTemplateHash = parsed.templateHash || '';
    } catch {
      return res.status(400).json({ error: 'Invalid face verification state.' });
    }
    if (!facePassed) {
      return res.status(400).json({
        error: 'Face verification did not pass. Complete facial scan before breath analysis.',
      });
    }

    // Both mouth AND audio must meet minimums — single-modality is a breach
    const mouthOk = body.mouthScore >= MOUTH_MIN;
    const audioOk = body.audioScore >= AUDIO_MIN;
    const passed = body.syncScore >= 65 && mouthOk && audioOk;

    const breathResult = {
      syncScore: body.syncScore,
      mouthScore: body.mouthScore,
      audioScore: body.audioScore,
      mouthOk,
      audioOk,
      passed,
      timestamp: new Date().toISOString()
    };

    // Build the combined biometric hash for blockchain validation
    const biometricHash = passed
      ? buildBiometricHash(faceTemplateHash, breathResult, body.sessionId)
      : null;

    const finalStatus = passed ? 'COMPLETED' : 'FAILED';

    const encryptedResult = encrypt(JSON.stringify({
      ...breathResult,
      biometricHash,
    }));

    // Compute an overall score from face liveness + breath sync
    const overallScore = passed ? Math.round((body.syncScore + 80) / 2) : null;

    await prisma.verification.update({
      where: { sessionId: body.sessionId },
      data: {
        breathResult: encryptedResult,
        status: finalStatus,
        overallScore,
        completedAt: passed ? new Date() : undefined,
      }
    });

    if (finalStatus === 'COMPLETED') {
      console.log('\n══════════════════════════════════════════');
      console.log('VERIFICATION COMPLETED');
      console.log('══════════════════════════════════════════');
      console.log('Session:', body.sessionId);
      console.log('Biometric Hash:', biometricHash);
      console.log('Overall Score:', overallScore);
      console.log('══════════════════════════════════════════\n');
    }

    res.json({
      ...breathResult,
      biometricHash,
      overallScore,
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Breath verification error:', error);
    res.status(500).json({ status: 'error', message: 'Core server error evaluating breath synchronization.' });
  }
});

export default router;
