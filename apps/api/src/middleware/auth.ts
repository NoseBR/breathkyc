import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../utils/prisma";

export async function apiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.headers["x-api-key"] as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "Missing x-api-key header" });
    return;
  }

  const prefix = apiKey.substring(0, 8);

  const candidates = await prisma.apiKey.findMany({
    where: { prefix, isActive: true },
    include: { client: true },
  });

  for (const candidate of candidates) {
    const matches = await bcrypt.compare(apiKey, candidate.keyHash);
    if (matches) {
      // Update last used
      await prisma.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsed: new Date() },
      });

      (req as Request & { client: { id: string; name: string } }).client = {
        id: candidate.client.id,
        name: candidate.client.name,
      };
      next();
      return;
    }
  }

  res.status(401).json({ error: "Invalid API key" });
}
