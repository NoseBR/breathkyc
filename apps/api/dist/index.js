"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const client_1 = require("@prisma/client");
const app = (0, express_1.default)();
const port = Number(process.env.PORT) || 3001;
const prisma = new client_1.PrismaClient();
const verification_1 = __importDefault(require("./routes/verification"));
const document_1 = __importDefault(require("./routes/document"));
const face_1 = __importDefault(require("./routes/face"));
const breath_1 = __importDefault(require("./routes/breath"));
const status_1 = __importDefault(require("./routes/status"));
const auth_1 = require("./middleware/auth");
const corsOrigin = process.env.CORS_ORIGIN || true;
app.use((0, helmet_1.default)({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use((0, cors_1.default)({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-breath-demo'],
}));
app.use(express_1.default.json());
// Apply API key auth to all verification routes
app.use('/v1/verify', auth_1.apiKeyAuth);
app.use('/v1/verify', verification_1.default);
app.use('/v1/verify/document', document_1.default);
app.use('/v1/verify/face', face_1.default);
app.use('/v1/verify/breath', breath_1.default);
app.use('/v1/verify/status', status_1.default);
// Basic health check endpoint
app.get('/health', async (req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({
            status: 'ok',
            db: 'connected',
            corsOrigin: String(corsOrigin),
            nodeEnv: process.env.NODE_ENV,
        });
    }
    catch (error) {
        console.error('Database connection error:', error);
        res.status(500).json({ status: 'error', db: 'disconnected' });
    }
});
app.listen(port, '0.0.0.0', () => {
    console.log(`BreathKYC API running on http://0.0.0.0:${port}`);
});
