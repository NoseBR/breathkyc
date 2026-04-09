"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
// Cache validated keys for 5 minutes to avoid repeated DB + bcrypt lookups
const keyCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
async function apiKeyAuth(req, res, next) {
    // Allow demo bypass for the frontend verification flow
    const demoHeader = req.headers['x-breath-demo'];
    if (demoHeader === 'true') {
        return next();
    }
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Provide a valid API key via the x-api-key header.'
        });
    }
    // Check cache first
    const cached = keyCache.get(apiKey);
    if (cached && cached.expiresAt > Date.now()) {
        req.clientId = cached.clientId;
        return next();
    }
    try {
        // Extract prefix for fast lookup (bk_live_XXXXXXXX -> first 16 chars)
        const prefix = apiKey.substring(0, 16);
        // Find matching key records by prefix
        const candidates = await prisma.apiKey.findMany({
            where: { prefix, isActive: true },
            include: { client: true }
        });
        if (candidates.length === 0) {
            return res.status(401).json({ error: 'Invalid API key' });
        }
        // Verify against bcrypt hash
        for (const candidate of candidates) {
            const isValid = await bcryptjs_1.default.compare(apiKey, candidate.keyHash);
            if (isValid) {
                if (!candidate.client.isActive) {
                    return res.status(403).json({ error: 'Client account is deactivated' });
                }
                // Update lastUsed timestamp (fire and forget)
                prisma.apiKey.update({
                    where: { id: candidate.id },
                    data: { lastUsed: new Date() }
                }).catch(() => { }); // Non-blocking
                // Cache the validated key
                keyCache.set(apiKey, {
                    clientId: candidate.clientId,
                    expiresAt: Date.now() + CACHE_TTL_MS
                });
                req.clientId = candidate.clientId;
                return next();
            }
        }
        return res.status(401).json({ error: 'Invalid API key' });
    }
    catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({ error: 'Authentication service error' });
    }
}
