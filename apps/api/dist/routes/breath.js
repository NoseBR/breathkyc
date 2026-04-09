"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const crypto_1 = require("../lib/crypto");
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
const breathSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    syncScore: zod_1.z.number().min(0).max(100),
    audioPayload: zod_1.z.any().optional(),
});
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
        try {
            const raw = verification.faceResult;
            const parsed = raw.startsWith('{')
                ? JSON.parse(raw)
                : JSON.parse((0, crypto_1.decrypt)(raw));
            facePassed = Boolean(parsed.passed);
        }
        catch {
            return res.status(400).json({ error: 'Invalid face verification state.' });
        }
        if (!facePassed) {
            return res.status(400).json({
                error: 'Face verification did not pass. Complete facial match before breath analysis.',
            });
        }
        // Client sends combined breath confidence (mouth motion and/or breath audio).
        const passed = body.syncScore >= 65;
        const breathResult = {
            syncScore: body.syncScore,
            passed,
            timestamp: new Date().toISOString()
        };
        const finalStatus = passed ? 'COMPLETED' : 'FAILED';
        // B2: Encrypting breath protocol outcome
        const encryptedResult = (0, crypto_1.encrypt)(JSON.stringify(breathResult));
        await prisma.verification.update({
            where: { sessionId: body.sessionId },
            data: {
                breathResult: encryptedResult,
                status: finalStatus
            }
        });
        // --- MOCK WEBHOOK DISPATCH ---
        if (finalStatus === 'COMPLETED') {
            const updatedVerification = await prisma.verification.findUnique({
                where: { sessionId: body.sessionId }
            });
            const safeDecrypt = (val) => {
                if (!val)
                    return null;
                try {
                    return JSON.parse((0, crypto_1.decrypt)(val));
                }
                catch {
                    return null;
                }
            };
            const webhookPayload = {
                event: 'verification.completed',
                sessionId: body.sessionId,
                status: 'COMPLETED',
                timestamp: new Date().toISOString(),
                results: {
                    geo: updatedVerification?.geoResult ? JSON.parse(updatedVerification.geoResult) : null,
                    document: safeDecrypt(updatedVerification?.documentResult || null),
                    face: safeDecrypt(updatedVerification?.faceResult || null),
                    breath: breathResult,
                }
            };
            console.log('\n══════════════════════════════════════════');
            console.log('🔔 WEBHOOK DISPATCH (mock)');
            console.log('══════════════════════════════════════════');
            console.log(JSON.stringify(webhookPayload, null, 2));
            console.log('══════════════════════════════════════════\n');
        }
        res.json(breathResult);
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
