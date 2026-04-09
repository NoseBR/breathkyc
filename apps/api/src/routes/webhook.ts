import { Router } from "express";

const router = Router();

// POST /v1/webhook/test — Test webhook delivery (for B2B clients to verify their endpoint)
router.post("/test", async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "Missing webhook URL" });
    return;
  }

  try {
    const testPayload = {
      event: "test",
      sessionId: "test_session_" + Date.now(),
      status: "PASSED",
      overallScore: 85,
      completedAt: new Date().toISOString(),
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(10000),
    });

    res.json({
      success: response.ok,
      statusCode: response.status,
    });
  } catch (err) {
    res.json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export { router as webhookRouter };
