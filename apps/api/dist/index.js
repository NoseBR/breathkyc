"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const verification_1 = require("./routes/verification");
const breath_1 = require("./routes/breath");
const dashboard_1 = require("./routes/dashboard");
const webhook_1 = require("./routes/webhook");
const logging_1 = require("./middleware/logging");
const app = (0, express_1.default)();
const PORT = process.env.PORT ?? 3001;
// Security & parsing
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" }));
app.use(express_1.default.json({ limit: "10mb" }));
app.use(logging_1.loggingMiddleware);
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
app.use("/v1/verify", verification_1.verificationRouter);
app.use("/v1/verify", breath_1.breathRouter);
app.use("/v1/dashboard", dashboard_1.dashboardRouter);
app.use("/v1/webhook", webhook_1.webhookRouter);
// Global error handler
app.use((err, _req, res, _next) => {
    console.error("[ERROR]", err.message);
    res.status(500).json({ error: "Internal server error" });
});
app.listen(PORT, () => {
    console.log(`BreathKYC API running on http://localhost:${PORT}`);
});
exports.default = app;
//# sourceMappingURL=index.js.map