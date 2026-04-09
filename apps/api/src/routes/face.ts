import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { encrypt } from '../lib/crypto';
import { buildLiveFaceTemplate, templateToJson } from '../lib/faceMatch';

const LIVENESS_MIN = 60;

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
    const livenessPassed = parsedLiveness >= LIVENESS_MIN;

    // Build facial biometric template from the live selfie
    let faceTemplateJson = '';
    try {
      const faceBuffer = fs.readFileSync(req.file.path);
      const template = await buildLiveFaceTemplate(faceBuffer);
      faceTemplateJson = templateToJson(template);
    } catch (e) {
      console.error('Face template build error:', e);
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Could not extract facial features. Ensure good lighting and face is clearly visible.' });
    }

    const passed = livenessPassed;

    const faceResult = {
      livenessScore: parsedLiveness,
      passed,
      livenessPassed,
      livenessMin: LIVENESS_MIN,
      templateHash: require('crypto').createHash('sha256').update(faceTemplateJson).digest('hex'),
      timestamp: new Date().toISOString(),
    };

    const encryptedResult = encrypt(JSON.stringify(faceResult));
    const encryptedTemplate = encrypt(faceTemplateJson);

    await prisma.verification.update({
      where: { sessionId },
      data: {
        faceResult: encryptedResult,
        documentFaceTemplate: encryptedTemplate,
        status: passed ? 'IN_PROGRESS' : 'FAILED'
      }
    });

    // Auto-delete the file (LGPD compliance)
    fs.unlinkSync(req.file.path);

    res.json(faceResult);

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Face upload error:', error);
    res.status(500).json({ error: 'Failed to process facial biometrics' });
  }
});

export default router;
