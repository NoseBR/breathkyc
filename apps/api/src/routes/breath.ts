import { Router } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { dispatchWebhook } from "../utils/webhook";

const router = Router();

const breathSchema = z.object({
  sessionId: z.string(),
  audioFeatures: z.record(z.unknown()),
  visualFeatures: z.record(z.unknown()),
  correlationScore: z.number().min(0).max(40),
  totalScore: z.number().min(0).max(100),
});

// POST /v1/verify/breath — Submit breath analysis results
router.post("/breath", async (req, res) => {
  const parsed = breathSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const { sessionId, audioFeatures, visualFeatures, correlationScore, totalScore } = parsed.data;

  try {
    const verification = await prisma.verification.findUnique({
      where: { sessionId },
      include: { client: true },
    });

    if (!verification) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (new Date() > verification.expiresAt) {
      res.status(410).json({ error: "Session expired" });
      return;
    }

    // Server-side sanity checks
    const audioScore = (audioFeatures as { overallScore?: number }).overallScore ?? 0;
    const visualScore = (visualFeatures as { overallScore?: number }).overallScore ?? 0;

    // Verify scores are within reasonable bounds
    if (audioScore > 30 || visualScore > 30 || correlationScore > 40) {
      res.status(400).json({ error: "Score values out of acceptable range" });
      return;
    }

    // Check that total matches components (with tolerance)
    const expectedTotal = audioScore + visualScore + correlationScore;
    if (Math.abs(totalScore - expectedTotal) > 2) {
      res.status(400).json({ error: "Score mismatch" });
      return;
    }

    const passed = totalScore >= 70;
    const finalStatus = passed ? "PASSED" : "FAILED";

    // Calculate overall KYC score (average of all steps)
    const geoScore = verification.geoResult ? 100 : 0;
    const docScore = verification.documentResult ? 85 : 0;
    const faceScore = (verification.faceResult as { matchScore?: number } | null)?.matchScore ?? 0;
    const overallScore = Math.round((geoScore + docScore + faceScore + totalScore) / 4);

    const breathResult = JSON.parse(JSON.stringify({
      audioFeatures,
      visualFeatures,
      correlationScore,
      totalScore,
      audioScore,
      visualScore,
      passed,
    }));

    await prisma.verification.update({
      where: { sessionId },
      data: {
        breathResult,
        overallScore,
        status: finalStatus,
        completedAt: new Date(),
      },
    });

    // Dispatch webhook to B2B client if configured
    if (verification.client.webhookUrl) {
      // Fire and forget
      dispatchWebhook(verification.client.webhookUrl, {
        sessionId,
        status: finalStatus,
        overallScore,
        completedAt: new Date().toISOString(),
      }).catch(console.error);
    }

    res.json({
      audioScore,
      visualScore,
      correlationScore,
      totalScore,
      passed,
      overallScore,
      status: finalStatus,
    });
  } catch (err) {
    console.error("[verify/breath]", err);
    res.status(500).json({ error: "Breath verification failed" });
  }
});

export { router as breathRouter };
