import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { encrypt, hashPII } from '../lib/crypto';
import { buildDocumentPortraitTemplateFromNormalized, templateToJson } from '../lib/faceMatch';
import { parseBrazilianIdFields, validateConfirmedDocumentFields } from '../lib/brazilIdParse';
import { runTesseractOcrWithBestOrientation } from '../services/ocr/tesseractOcr';

const router = Router();
const prisma = new PrismaClient();

// Setup multer for local disk storage (MVP)
const uploadDir = path.join(__dirname, '../../tmp/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 } // high-res phone / scanner photos
});

router.post('/', upload.single('document'), async (req, res) => {
  try {
    const { sessionId, documentType } = req.body;

    if (!sessionId || !documentType) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'sessionId and documentType are required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'document image file is required' });
    }

    // Verify session
    const verification = await prisma.verification.findUnique({
      where: { sessionId }
    });

    if (!verification) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Session not found' });
    }

    const imageBuffer = fs.readFileSync(req.file.path);
    if (!imageBuffer.length || imageBuffer.length < 32) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Image file is empty or incomplete. Try capturing again.' });
    }

    let ocrConfidence = 0;
    let extractedData = {
      name: '',
      cpf: '',
      dateOfBirth: '',
      documentNumber: '',
    };

    let ocrAutoRotateDegrees = 0;
    let ocrResult: Awaited<ReturnType<typeof runTesseractOcrWithBestOrientation>>;
    try {
      ocrResult = await runTesseractOcrWithBestOrientation(imageBuffer);
      extractedData = parseBrazilianIdFields(ocrResult.text);
      ocrConfidence = ocrResult.confidence;
      ocrAutoRotateDegrees = ocrResult.orientationDegrees;
    } catch (e) {
      console.error('Tesseract OCR error:', e);
      fs.unlinkSync(req.file.path);
      return res.status(500).json({
        error: 'OCR failed. Ensure the API can reach the network on first run (language models download) or try again.',
      });
    }

    const documentResult = {
      documentType,
      ocrEngine: 'tesseract' as const,
      ocrConfidence,
      /** Clockwise rotation applied so text reads upright (0 if already correct). */
      ocrAutoRotateDegrees,
      passed: true,
      extractedData,
    };

    try {
      const portraitVec = await buildDocumentPortraitTemplateFromNormalized(
        ocrResult.orientedDecoded,
        documentType
      );
      let encryptedTemplate: string;
      try {
        encryptedTemplate = encrypt(templateToJson(portraitVec));
      } catch (encErr) {
        console.error('Document template encrypt error:', encErr);
        fs.unlinkSync(req.file.path);
        return res.status(500).json({
          error: 'Server could not store portrait data. Check ENCRYPTION_KEY (32-byte secret) in API .env.',
        });
      }
      await prisma.verification.update({
        where: { sessionId },
        data: { documentFaceTemplate: encryptedTemplate },
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error('Document portrait template error:', detail);
      fs.unlinkSync(req.file.path);
      const hint =
        /heif|heic|unsupported|unsupported image/i.test(detail)
          ? ' Try saving as JPEG or PNG (HEIC may need server support).'
          : '';
      return res.status(400).json({
        error: `Could not build portrait template from this image.${hint} Use a well-lit, flat CNH photo (full card visible).`,
      });
    }

    // Auto-delete the file after "processing" (LGPD compliance)
    fs.unlinkSync(req.file.path);

    res.json(documentResult);

  } catch (error) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error('Document upload error:', error);
    res.status(500).json({ error: 'Failed to process document' });
  }
});

const confirmSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  cpf: z.string(),
  dateOfBirth: z.string(),
  documentNumber: z.string()
});

router.post('/confirm', async (req, res) => {
  try {
    const body = confirmSchema.parse(req.body);

    const verification = await prisma.verification.findUnique({
      where: { sessionId: body.sessionId }
    });

    if (!verification) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const validationError = validateConfirmedDocumentFields({
      name: body.name,
      cpf: body.cpf,
      dateOfBirth: body.dateOfBirth,
      documentNumber: body.documentNumber,
    });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const confirmedData = {
      name: body.name,
      cpf: body.cpf,
      dateOfBirth: body.dateOfBirth,
      documentNumber: body.documentNumber,
      confirmedAt: new Date().toISOString()
    };

    const docResultJson = JSON.stringify({
      extractedData: confirmedData,
      passed: true
    });

    // B2: Encrypting PII before storage
    const encryptedResult = encrypt(docResultJson);
    
    // B3: SHA-256 for deduplication without storing raw CPF
    const cpfHash = hashPII(body.cpf);

    // Save to database
    await prisma.verification.update({
      where: { sessionId: body.sessionId },
      data: {
        documentResult: encryptedResult,
        cpfHash: cpfHash
      }
    });

    res.json({ success: true }); // Minimize data leaks in confirmation

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error('Document confirm error:', error);
    res.status(500).json({ error: 'Server error saving extracted data' });
  }
});

export default router;
