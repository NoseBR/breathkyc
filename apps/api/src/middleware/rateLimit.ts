import type { Request, Response, NextFunction } from "express";

// Simple in-memory rate limiter (replace with Redis in production)
const requestCounts = new Map<string, { count: number; resetAt: number }>();

const DEFAULT_LIMIT = 100;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function rateLimit(limit = DEFAULT_LIMIT) {
  return (req: Request, res: Response, next: NextFunction): void => {
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
