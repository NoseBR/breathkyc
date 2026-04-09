import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { encrypt, decrypt } from '../lib/crypto';
import { matchDocumentTemplateToLive, templateFromJson } from '../lib/faceMatch';

/** Demo MVP: MediaPipe liveness is strict; embedding is heuristic (not FaceNet). */
const LIVENESS_MIN = 60;
const MATCH_MIN = 48;

const router = Router();
const prisma = new PrismaClient();

const uploadDir = path.join(__dirname, '../../tmp/uploads/faces');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'face-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post('/', upload.single('face'), async (req, res) => {
  try {
    const { sessionId, livenessScore } = req.body;

    if (!sessionId || livenessScore === undefined) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'sessionId and livenessScore are required' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'face image file is required' });
    }

    const verification = await prisma.verification.findUnique({
      where: { sessionId }
    });

    if (!verification) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Session not found' });
    }

    const parsedLiveness = parseFloat(livenessScore);

    if (!verification.documentFaceTemplate) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        error: 'No document portrait on file. Complete document capture before face verification.',
      });
    }

    let matchScore = 0;
    try {
      const docJson = decrypt(verification.documentFaceTemplate);
      const docVec = templateFromJson(docJson);
      const faceBuffer = fs.readFileSync(req.file.path);
      matchScore = await matchDocumentTemplateToLive(docVec, faceBuffer);
    } catch (e) {
      console.error('Face match error:', e);
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not compare face to document portrait.' });
    }

    const livenessPassed = parsedLiveness >= LIVENESS_MIN;
    const matchPassed = matchScore >= MATCH_MIN;
    const passed = livenessPassed && matchPassed;

    const faceResult = {
      matchScore,
      livenessScore: parsedLiveness,
      passed,
      livenessPassed,
      matchPassed,
      livenessMin: LIVENESS_MIN,
      matchMin: MATCH_MIN,
      timestamp: new Date().toISOString(),
    };

    // B2: Encrypting PII outcome
    const encryptedResult = encrypt(JSON.stringify(faceResult));

    await prisma.verification.update({
      where: { sessionId },
      data: {
        faceResult: encryptedResult,
        status: passed ? 'IN_PROGRESS' : 'FAILED'
      }
    });

    // Auto-delete the file after "processing" (LGPD compliance)
    fs.unlinkSync(req.file.path);

    res.json(faceResult);

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Face upload error:', error);
    res.status(500).json({ error: 'Failed to process facial biometrics' });
  }
});

export default router;
