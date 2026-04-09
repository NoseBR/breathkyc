"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = require("../lib/crypto");
const faceMatch_1 = require("../lib/faceMatch");
const brazilIdParse_1 = require("../lib/brazilIdParse");
const tesseractOcr_1 = require("../services/ocr/tesseractOcr");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Setup multer for local disk storage (MVP)
const uploadDir = path_1.default.join(__dirname, '../../tmp/uploads');
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 } // high-res phone / scanner photos
});
router.post('/', upload.single('document'), async (req, res) => {
    try {
        const { sessionId, documentType } = req.body;
        if (!sessionId || !documentType) {
            if (req.file)
                fs_1.default.unlinkSync(req.file.path);
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
            fs_1.default.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Session not found' });
        }
        const imageBuffer = fs_1.default.readFileSync(req.file.path);
        if (!imageBuffer.length || imageBuffer.length < 32) {
            fs_1.default.unlinkSync(req.file.path);
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
        let ocrResult;
        try {
            ocrResult = await (0, tesseractOcr_1.runTesseractOcrWithBestOrientation)(imageBuffer);
            extractedData = (0, brazilIdParse_1.parseBrazilianIdFields)(ocrResult.text);
            ocrConfidence = ocrResult.confidence;
            ocrAutoRotateDegrees = ocrResult.orientationDegrees;
        }
        catch (e) {
            console.error('Tesseract OCR error:', e);
            fs_1.default.unlinkSync(req.file.path);
            return res.status(500).json({
                error: 'OCR failed. Ensure the API can reach the network on first run (language models download) or try again.',
            });
        }
        const documentResult = {
            documentType,
            ocrEngine: 'tesseract',
            ocrConfidence,
            /** Clockwise rotation applied so text reads upright (0 if already correct). */
            ocrAutoRotateDegrees,
            passed: true,
            extractedData,
        };
        try {
            const portraitVec = await (0, faceMatch_1.buildDocumentPortraitTemplateFromNormalized)(ocrResult.orientedDecoded, documentType);
            let encryptedTemplate;
            try {
                encryptedTemplate = (0, crypto_1.encrypt)((0, faceMatch_1.templateToJson)(portraitVec));
            }
            catch (encErr) {
                console.error('Document template encrypt error:', encErr);
                fs_1.default.unlinkSync(req.file.path);
                return res.status(500).json({
                    error: 'Server could not store portrait data. Check ENCRYPTION_KEY (32-byte secret) in API .env.',
                });
            }
            await prisma.verification.update({
                where: { sessionId },
                data: { documentFaceTemplate: encryptedTemplate },
            });
        }
        catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            console.error('Document portrait template error:', detail);
            fs_1.default.unlinkSync(req.file.path);
            const hint = /heif|heic|unsupported|unsupported image/i.test(detail)
                ? ' Try saving as JPEG or PNG (HEIC may need server support).'
                : '';
            return res.status(400).json({
                error: `Could not build portrait template from this image.${hint} Use a well-lit, flat CNH photo (full card visible).`,
            });
        }
        // Auto-delete the file after "processing" (LGPD compliance)
        fs_1.default.unlinkSync(req.file.path);
        res.json(documentResult);
    }
    catch (error) {
        if (req.file)
            fs_1.default.unlinkSync(req.file.path);
        console.error('Document upload error:', error);
        res.status(500).json({ error: 'Failed to process document' });
    }
});
const confirmSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    name: zod_1.z.string(),
    cpf: zod_1.z.string(),
    dateOfBirth: zod_1.z.string(),
    documentNumber: zod_1.z.string()
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
        const validationError = (0, brazilIdParse_1.validateConfirmedDocumentFields)({
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
        const encryptedResult = (0, crypto_1.encrypt)(docResultJson);
        // B3: SHA-256 for deduplication without storing raw CPF
        const cpfHash = (0, crypto_1.hashPII)(body.cpf);
        // Save to database
        await prisma.verification.update({
            where: { sessionId: body.sessionId },
            data: {
                documentResult: encryptedResult,
                cpfHash: cpfHash
            }
        });
        res.json({ success: true }); // Minimize data leaks in confirmation
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Document confirm error:', error);
        res.status(500).json({ error: 'Server error saving extracted data' });
    }
});
exports.default = router;
