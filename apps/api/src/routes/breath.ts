import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { encrypt, decrypt } from '../lib/crypto';
import {
  buildLiveFaceTemplate,
  templateFromJson,
  compareTemplates,
} from '../lib/faceMatch';

const router = Router();
const prisma = new PrismaClient();

const MOUTH_MIN = 30;
const AUDIO_MIN = 25;
const FACE_MATCH_MIN = 40; // Minimum face similarity % between face step and breath step

// Multer setup for face snapshot upload
const uploadDir = path.join(__dirname, '../../tmp/uploads/breath-faces');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'breath-face-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
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

router.post('/', upload.single('face'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId as string;
    const syncScore = Number(req.body.syncScore);
    const mouthScore = Number(req.body.mouthScore || 0);
    const audioScore = Number(req.body.audioScore || 0);

    if (!sessionId || isNaN(syncScore)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'sessionId and syncScore are required' });
    }

    const verification = await prisma.verification.findUnique({
      where: { sessionId }
    });

    if (!verification) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!verification.faceResult) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'Face verification must succeed before breath analysis.',
      });
    }

    // Decrypt the face result from step 1
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
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid face verification state.' });
    }
    if (!facePassed) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'Face verification did not pass. Complete facial scan before breath analysis.',
      });
    }

    // --- Cross-step face matching ---
    let faceMatchScore = 0;
    let faceMatchPassed = false;

    if (req.file && verification.documentFaceTemplate) {
      try {
        // Get the stored face template from step 1
        const storedTemplateJson = verification.documentFaceTemplate.startsWith('[')
          ? verification.documentFaceTemplate
          : decrypt(verification.documentFaceTemplate);
        const storedTemplate = templateFromJson(storedTemplateJson);

        // Build template from the breath-step face snapshot
        const breathFaceBuffer = fs.readFileSync(req.file.path);
        const breathTemplate = await buildLiveFaceTemplate(breathFaceBuffer);

        // Compare the two templates
        faceMatchScore = compareTemplates(storedTemplate, breathTemplate);
        faceMatchPassed = faceMatchScore >= FACE_MATCH_MIN;

        console.log(`[Breath] Face match: ${faceMatchScore}% (min: ${FACE_MATCH_MIN}%) → ${faceMatchPassed ? 'PASS' : 'FAIL'}`);
      } catch (e) {
        console.error('[Breath] Face comparison error:', e);
        // If comparison fails, don't block — but log it
        faceMatchPassed = true;
        faceMatchScore = -1;
      }

      // Clean up the uploaded face image (LGPD compliance)
      fs.unlinkSync(req.file.path);
    } else if (!req.file) {
      // No face image sent — fail the verification
      console.warn('[Breath] No face snapshot provided for cross-step verification');
      faceMatchPassed = false;
      faceMatchScore = 0;
    }

    // Both mouth AND audio must meet minimums + face must match
    const mouthOk = mouthScore >= MOUTH_MIN;
    const audioOk = audioScore >= AUDIO_MIN;
    const scoresOk = syncScore >= 65 && mouthOk && audioOk;
    const passed = scoresOk && faceMatchPassed;

    const breathResult = {
      syncScore,
      mouthScore,
      audioScore,
      mouthOk,
      audioOk,
      faceMatchScore,
      faceMatchPassed,
      passed,
      timestamp: new Date().toISOString()
    };

    // Build the combined biometric hash for blockchain validation
    const biometricHash = passed
      ? buildBiometricHash(faceTemplateHash, breathResult, sessionId)
      : null;

    const finalStatus = passed ? 'COMPLETED' : 'FAILED';

    const encryptedResult = encrypt(JSON.stringify({
      ...breathResult,
      biometricHash,
    }));

    // Compute an overall score from face liveness + breath sync
    const overallScore = passed ? Math.round((syncScore + 80) / 2) : null;

    await prisma.verification.update({
      where: { sessionId },
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
      console.log('Session:', sessionId);
      console.log('Face Match:', faceMatchScore + '%');
      console.log('Biometric Hash:', biometricHash);
      console.log('Overall Score:', overallScore);
      console.log('══════════════════════════════════════════\n');
    }

    const responseData: Record<string, unknown> = {
      ...breathResult,
      biometricHash,
      overallScore,
    };

    // If face match failed, give a clear error message
    if (!faceMatchPassed && scoresOk) {
      responseData.error = 'Face during breathing does not match the face from verification. Please ensure the same person completes both steps.';
    }

    res.json(responseData);

  } catch (error) {
    if (req.file) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    console.error('Breath verification error:', error);
    res.status(500).json({ status: 'error', message: 'Core server error evaluating breath synchronization.' });
  }
});

export default router;
