"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificationRouter = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const fs_1 = __importDefault(require("fs"));
const prisma_1 = require("../utils/prisma");
const encryption_1 = require("../utils/encryption");
const rateLimit_1 = require("../middleware/rateLimit");
const tesseractOcr_1 = require("../services/ocr/tesseractOcr");
const brazilIdParse_1 = require("../lib/brazilIdParse");
const router = (0, express_1.Router)();
exports.verificationRouter = router;
const upload = (0, multer_1.default)({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } });
// POST /v1/verify/start — Create a new verification session
router.post("/start", (0, rateLimit_1.rateLimit)(100), async (req, res) => {
    try {
        // For MVP, use a default client. In production, authenticate with API key.
        let client = await prisma_1.prisma.client.findFirst({ where: { isActive: true } });
        if (!client) {
            // Auto-create a demo client for MVP
            client = await prisma_1.prisma.client.create({
                data: {
                    name: "Demo Client",
                    email: "demo@breathkyc.com",
                    isActive: true,
                },
            });
        }
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min
        const verification = await prisma_1.prisma.verification.create({
            data: {
                clientId: client.id,
                status: "IN_PROGRESS",
                expiresAt,
            },
        });
        res.json({
            sessionId: verification.sessionId,
            expiresAt: expiresAt.toISOString(),
        });
    }
    catch (err) {
        console.error("[verify/start]", err);
        const message = err instanceof Error ? err.message : "Unknown error";
        res.status(500).json({ error: "Failed to create verification session", debug: message });
    }
});
// POST /v1/verify/geolocation
const geoSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    latitude: zod_1.z.number().min(-90).max(90),
    longitude: zod_1.z.number().min(-180).max(180),
});
router.post("/geolocation", async (req, res) => {
    const parsed = geoSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
        return;
    }
    const { sessionId, latitude, longitude } = parsed.data;
    try {
        const verification = await prisma_1.prisma.verification.findUnique({ where: { sessionId } });
        if (!verification) {
            res.status(404).json({ error: "Session not found" });
            return;
        }
        if (new Date() > verification.expiresAt) {
            res.status(410).json({ error: "Session expired" });
            return;
        }
        // IP-based geolocation check (MVP: use ip-api.com)
        const clientIp = req.ip ?? req.headers["x-forwarded-for"] ?? "unknown";
        let ipCountry = "BR"; // Default to Brazil for local dev
        let vpnDetected = false;
        try {
            const ipRes = await fetch(`http://ip-api.com/json/${clientIp}?fields=country,countryCode,proxy`);
            if (ipRes.ok) {
                const ipData = await ipRes.json();
                ipCountry = ipData.countryCode ?? "BR";
                vpnDetected = ipData.proxy ?? false;
            }
        }
        catch {
            // IP check failed, proceed with GPS only
        }
        // Check if in Brazil (or allowed jurisdictions)
        const allowed = !vpnDetected; // For MVP, allow all locations but flag VPN
        const geoResult = {
            latitude,
            longitude,
            country: ipCountry,
            region: "Unknown",
            vpnDetected,
            allowed,
        };
        await prisma_1.prisma.verification.update({
            where: { sessionId },
            data: { geoResult },
        });
        res.json({
            allowed: geoResult.allowed,
            country: geoResult.country,
            region: geoResult.region,
            vpnDetected: geoResult.vpnDetected,
        });
    }
    catch (err) {
        console.error("[verify/geolocation]", err);
        res.status(500).json({ error: "Geolocation check failed" });
    }
});
// POST /v1/verify/document — Upload and OCR document
router.post("/document", upload.single("document"), async (req, res) => {
    const sessionId = req.body?.sessionId;
    const documentType = req.body?.documentType;
    if (!sessionId || !documentType || !req.file) {
        res.status(400).json({ error: "Missing sessionId, documentType, or document file" });
        return;
    }
    try {
        const verification = await prisma_1.prisma.verification.findUnique({ where: { sessionId } });
        if (!verification) {
            res.status(404).json({ error: "Session not found" });
            return;
        }
        // Read uploaded file into a buffer for Tesseract OCR
        const imageBuffer = fs_1.default.readFileSync(req.file.path);
        const ocrResult = await (0, tesseractOcr_1.runTesseractOcrWithBestOrientation)(imageBuffer);
        const parsed = (0, brazilIdParse_1.parseBrazilianIdFields)(ocrResult.text);
        const ocrData = {
            name: parsed.name,
            cpf: parsed.cpf,
            dateOfBirth: parsed.dateOfBirth,
            documentNumber: parsed.documentNumber,
            ocrConfidence: ocrResult.confidence / 100, // normalize to 0-1
        };
        await prisma_1.prisma.verification.update({
            where: { sessionId },
            data: {
                documentResult: {
                    documentType,
                    ...ocrData,
                    ocrText: ocrResult.text,
                    orientationDegrees: ocrResult.orientationDegrees,
                    imagePath: req.file.path,
                },
            },
        });
        res.json(ocrData);
    }
    catch (err) {
        console.error("[verify/document]", err);
        res.status(500).json({ error: "Document processing failed" });
    }
});
// POST /v1/verify/document/confirm
const confirmSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    name: zod_1.z.string().min(1),
    cpf: zod_1.z.string().min(11),
    dateOfBirth: zod_1.z.string(),
    documentNumber: zod_1.z.string(),
});
router.post("/document/confirm", async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
        return;
    }
    const { sessionId, name, cpf, dateOfBirth, documentNumber } = parsed.data;
    try {
        const verification = await prisma_1.prisma.verification.findUnique({ where: { sessionId } });
        if (!verification) {
            res.status(404).json({ error: "Session not found" });
            return;
        }
        const cpfHashed = (0, encryption_1.hashCpf)(cpf.replace(/\D/g, ""));
        await prisma_1.prisma.verification.update({
            where: { sessionId },
            data: {
                cpfHash: cpfHashed,
                documentResult: {
                    ...(verification.documentResult ?? {}),
                    confirmedName: name,
                    confirmedCpf: cpf,
                    confirmedDob: dateOfBirth,
                    confirmedDocNumber: documentNumber,
                },
            },
        });
        res.json({ success: true });
    }
    catch (err) {
        console.error("[verify/document/confirm]", err);
        res.status(500).json({ error: "Confirmation failed" });
    }
});
// POST /v1/verify/face — Upload face image and compare
router.post("/face", upload.single("face"), async (req, res) => {
    const sessionId = req.body?.sessionId;
    const livenessScore = parseFloat(req.body?.livenessScore ?? "0");
    if (!sessionId || !req.file) {
        res.status(400).json({ error: "Missing sessionId or face image" });
        return;
    }
    try {
        const verification = await prisma_1.prisma.verification.findUnique({ where: { sessionId } });
        if (!verification) {
            res.status(404).json({ error: "Session not found" });
            return;
        }
        // MVP: Simulate face match with high score. Real comparison (Rekognition) in Phase B.
        const matchScore = 75 + Math.floor(Math.random() * 20); // 75-95
        const passed = matchScore >= 70 && livenessScore >= 75;
        const faceResult = {
            matchScore,
            livenessScore,
            passed,
            imagePath: req.file.path,
        };
        await prisma_1.prisma.verification.update({
            where: { sessionId },
            data: { faceResult },
        });
        res.json({ matchScore, livenessScore, passed });
    }
    catch (err) {
        console.error("[verify/face]", err);
        res.status(500).json({ error: "Face verification failed" });
    }
});
// GET /v1/verify/:sessionId — Get verification result
router.get("/:sessionId", async (req, res) => {
    try {
        const verification = await prisma_1.prisma.verification.findUnique({
            where: { sessionId: req.params.sessionId },
            select: {
                sessionId: true,
                status: true,
                overallScore: true,
                completedAt: true,
                createdAt: true,
            },
        });
        if (!verification) {
            res.status(404).json({ error: "Session not found" });
            return;
        }
        res.json(verification);
    }
    catch (err) {
        console.error("[verify/:sessionId]", err);
        res.status(500).json({ error: "Failed to retrieve result" });
    }
});
//# sourceMappingURL=verification.js.map