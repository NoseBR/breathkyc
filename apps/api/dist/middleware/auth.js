"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma_1 = require("../utils/prisma");
async function apiKeyAuth(req, res, next) {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
        res.status(401).json({ error: "Missing x-api-key header" });
        return;
    }
    const prefix = apiKey.substring(0, 8);
    const candidates = await prisma_1.prisma.apiKey.findMany({
        where: { prefix, isActive: true },
        include: { client: true },
    });
    for (const candidate of candidates) {
        const matches = await bcrypt_1.default.compare(apiKey, candidate.keyHash);
        if (matches) {
            // Update last used
            await prisma_1.prisma.apiKey.update({
                where: { id: candidate.id },
                data: { lastUsed: new Date() },
            });
            req.client = {
                id: candidate.client.id,
                name: candidate.client.name,
            };
            next();
            return;
        }
    }
    res.status(401).json({ error: "Invalid API key" });
}
//# sourceMappingURL=auth.js.map