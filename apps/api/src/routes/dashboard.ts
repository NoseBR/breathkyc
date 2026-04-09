import { Router } from "express";
import { prisma } from "../utils/prisma";

const router = Router();

// GET /v1/dashboard/stats — Usage statistics (MVP: simplified without auth)
router.get("/stats", async (_req, res) => {
  try {
    const [total, passed, failed, pending] = await Promise.all([
      prisma.verification.count(),
      prisma.verification.count({ where: { status: "PASSED" } }),
      prisma.verification.count({ where: { status: "FAILED" } }),
      prisma.verification.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } }),
    ]);

    res.json({
      total,
      passed,
      failed,
      pending,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    });
  } catch (err) {
    console.error("[dashboard/stats]", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// GET /v1/dashboard/verifications — List recent verifications
router.get("/verifications", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const [verifications, total] = await Promise.all([
      prisma.verification.findMany({
        select: {
          sessionId: true,
          status: true,
          overallScore: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.verification.count(),
    ]);

    res.json({
      data: verifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[dashboard/verifications]", err);
    res.status(500).json({ error: "Failed to fetch verifications" });
  }
});

export { router as dashboardRouter };
