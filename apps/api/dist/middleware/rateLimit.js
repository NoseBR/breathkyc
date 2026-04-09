"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = rateLimit;
// Simple in-memory rate limiter (replace with Redis in production)
const requestCounts = new Map();
const DEFAULT_LIMIT = 100;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
function rateLimit(limit = DEFAULT_LIMIT) {
    return (req, res, next) => {
        const key = req.ip ?? "unknown";
        const now = Date.now();
        const entry = requestCounts.get(key);
        if (!entry || now > entry.resetAt) {
            requestCounts.set(key, { count: 1, resetAt: now + WINDOW_MS });
            next();
            return;
        }
        if (entry.count >= limit) {
            res.status(429).json({ error: "Rate limit exceeded. Try again later." });
            return;
        }
        entry.count++;
        next();
    };
}
//# sourceMappingURL=rateLimit.js.map