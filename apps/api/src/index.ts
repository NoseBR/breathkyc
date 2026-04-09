import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { verificationRouter } from "./routes/verification";
import { breathRouter } from "./routes/breath";
import { dashboardRouter } from "./routes/dashboard";
import { webhookRouter } from "./routes/webhook";
import { loggingMiddleware } from "./middleware/logging";

const app = express();
const PORT = process.env.PORT ?? 3001;

// Security & parsing
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json({ limit: "10mb" }));
app.use(loggingMiddleware);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "breathkyc-api",
    timestamp: new Date().toISOString(),
    env: {
      hasDbUrl: !!process.env.DATABASE_URL,
      corsOrigin: process.env.CORS_ORIGIN ?? "NOT SET",
      nodeEnv: process.env.NODE_ENV ?? "NOT SET",
    },
  });
});

// Routes
app.use("/v1/verify", verificationRouter);
app.use("/v1/verify", breathRouter);
app.use("/v1/dashboard", dashboardRouter);
app.use("/v1/webhook", webhookRouter);

// Global error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("[ERROR]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(PORT, () => {
  console.log(`BreathKYC API running on http://localhost:${PORT}`);
});

export default app;
