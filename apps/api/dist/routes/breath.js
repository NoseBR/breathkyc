"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const crypto_1 = __importDefault(require("crypto"));
const crypto_2 = require("../lib/crypto");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const breathSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    syncScore: zod_1.z.number().min(0).max(100),
    audioPayload: zod_1.z.any().optional(),
});
/**
 * Combine face template hash + breath data + session into a single
 * biometric hashcode suitable for on-chain storage as a validator.
 */
function buildBiometricHash(faceTemplateHash, breathData, sessionId) {
    const payload = JSON.stringify({
        face: faceTemplateHash,
        breath: breathData,
        session: sessionId,
        version: 'breathkyc-v1',
    });
    return crypto_1.default.createHash('sha256').update(payload).digest('hex');
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
                ? JSON.parse(raw)
                : JSON.parse((0, crypto_2.decrypt)(raw));
            facePassed = Boolean(parsed.passed);
            faceTemplateHash = parsed.templateHash || '';
        }
        catch {
            return res.status(400).json({ error: 'Invalid face verification state.' });
        }
        if (!facePassed) {
            return res.status(400).json({
                error: 'Face verification did not pass. Complete facial scan before breath analysis.',
            });
        }
        const passed = body.syncScore >= 65;
        const breathResult = {
            syncScore: body.syncScore,
            passed,
            timestamp: new Date().toISOString()
        };
        // Build the combined biometric hash for blockchain validation
        const biometricHash = passed
            ? buildBiometricHash(faceTemplateHash, breathResult, body.sessionId)
            : null;
        const finalStatus = passed ? 'COMPLETED' : 'FAILED';
        const encryptedResult = (0, crypto_2.encrypt)(JSON.stringify({
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
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        console.error('Breath verification error:', error);
        res.status(500).json({ status: 'error', message: 'Core server error evaluating breath synchronization.' });
    }
});
exports.default = router;
