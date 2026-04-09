"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const crypto_1 = require("../lib/crypto");
const faceMatch_1 = require("../lib/faceMatch");
/** Demo MVP: MediaPipe liveness is strict; embedding is heuristic (not FaceNet). */
const LIVENESS_MIN = 60;
const MATCH_MIN = 48;
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const uploadDir = path_1.default.join(__dirname, '../../tmp/uploads/faces');
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'face-' + uniqueSuffix + path_1.default.extname(file.originalname));
    }
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});
router.post('/', upload.single('face'), async (req, res) => {
    try {
        const { sessionId, livenessScore } = req.body;
        if (!sessionId || livenessScore === undefined) {
            if (req.file)
                fs_1.default.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'sessionId and livenessScore are required' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'face image file is required' });
        }
        const verification = await prisma.verification.findUnique({
            where: { sessionId }
        });
        if (!verification) {
            fs_1.default.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Session not found' });
        }
        const parsedLiveness = parseFloat(livenessScore);
        if (!verification.documentFaceTemplate) {
            fs_1.default.unlinkSync(req.file.path);
            return res.status(400).json({
                error: 'No document portrait on file. Complete document capture before face verification.',
            });
        }
        let matchScore = 0;
        try {
            const docJson = (0, crypto_1.decrypt)(verification.documentFaceTemplate);
            const docVec = (0, faceMatch_1.templateFromJson)(docJson);
            const faceBuffer = fs_1.default.readFileSync(req.file.path);
            matchScore = await (0, faceMatch_1.matchDocumentTemplateToLive)(docVec, faceBuffer);
        }
        catch (e) {
            console.error('Face match error:', e);
            fs_1.default.unlinkSync(req.file.path);
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
        const encryptedResult = (0, crypto_1.encrypt)(JSON.stringify(faceResult));
        await prisma.verification.update({
            where: { sessionId },
            data: {
                faceResult: encryptedResult,
                status: passed ? 'IN_PROGRESS' : 'FAILED'
            }
        });
        // Auto-delete the file after "processing" (LGPD compliance)
        fs_1.default.unlinkSync(req.file.path);
        res.json(faceResult);
    }
    catch (error) {
        if (req.file)
            fs_1.default.unlinkSync(req.file.path);
        console.error('Face upload error:', error);
        res.status(500).json({ error: 'Failed to process facial biometrics' });
    }
});
exports.default = router;
