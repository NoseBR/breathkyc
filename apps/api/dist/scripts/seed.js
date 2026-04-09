"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
async function seed() {
    console.log('🌱 Seeding BreathKYC database...\n');
    // 1. Create or find demo client
    let client = await prisma.client.findFirst({ where: { email: 'demo@breath.id' } });
    if (!client) {
        client = await prisma.client.create({
            data: {
                name: 'Demo Client (Breath Protocol)',
                email: 'demo@breath.id',
                webhookUrl: 'https://webhook.site/demo', // Placeholder
            }
        });
        console.log('✅ Created demo client:', client.id);
    }
    else {
        console.log('ℹ️  Demo client already exists:', client.id);
    }
    // 2. Generate API Key
    const rawKey = `bk_live_${crypto_1.default.randomBytes(24).toString('hex')}`;
    const prefix = rawKey.substring(0, 16);
    const keyHash = await bcryptjs_1.default.hash(rawKey, 10);
    await prisma.apiKey.create({
        data: {
            keyHash,
            prefix,
            clientId: client.id,
        }
    });
    console.log('\n══════════════════════════════════════════');
    console.log('🔑 API KEY GENERATED (save this — it cannot be recovered)');
    console.log('══════════════════════════════════════════');
    console.log(`   ${rawKey}`);
    console.log('══════════════════════════════════════════');
    console.log(`\n   Prefix: ${prefix}`);
    console.log(`   Client: ${client.name}`);
    console.log(`   Email:  ${client.email}\n`);
    console.log('Usage:');
    console.log(`  curl -H "x-api-key: ${rawKey}" http://localhost:3001/v1/verify/start -X POST\n`);
    await prisma.$disconnect();
}
seed().catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
});
