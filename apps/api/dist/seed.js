"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var bcrypt_1 = __importDefault(require("bcrypt"));
var crypto_1 = __importDefault(require("crypto"));
var prisma = new client_1.PrismaClient();
function seed() {
    return __awaiter(this, void 0, void 0, function () {
        var client, rawKey, prefix, keyHash;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log('🌱 Seeding BreathKYC database...\n');
                    return [4 /*yield*/, prisma.client.findFirst({ where: { email: 'demo@breath.id' } })];
                case 1:
                    client = _a.sent();
                    if (!!client) return [3 /*break*/, 3];
                    return [4 /*yield*/, prisma.client.create({
                            data: {
                                name: 'Demo Client (Breath Protocol)',
                                email: 'demo@breath.id',
                                webhookUrl: 'https://webhook.site/demo', // Placeholder
                            }
                        })];
                case 2:
                    client = _a.sent();
                    console.log('✅ Created demo client:', client.id);
                    return [3 /*break*/, 4];
                case 3:
                    console.log('ℹ️  Demo client already exists:', client.id);
                    _a.label = 4;
                case 4:
                    rawKey = "bk_live_".concat(crypto_1.default.randomBytes(24).toString('hex'));
                    prefix = rawKey.substring(0, 16);
                    return [4 /*yield*/, bcrypt_1.default.hash(rawKey, 10)];
                case 5:
                    keyHash = _a.sent();
                    return [4 /*yield*/, prisma.apiKey.create({
                            data: {
                                keyHash: keyHash,
                                prefix: prefix,
                                clientId: client.id,
                            }
                        })];
                case 6:
                    _a.sent();
                    console.log('\n══════════════════════════════════════════');
                    console.log('🔑 API KEY GENERATED (save this — it cannot be recovered)');
                    console.log('══════════════════════════════════════════');
                    console.log("   ".concat(rawKey));
                    console.log('══════════════════════════════════════════');
                    console.log("\n   Prefix: ".concat(prefix));
                    console.log("   Client: ".concat(client.name));
                    console.log("   Email:  ".concat(client.email, "\n"));
                    console.log('Usage:');
                    console.log("  curl -H \"x-api-key: ".concat(rawKey, "\" http://localhost:3001/v1/verify/start -X POST\n"));
                    return [4 /*yield*/, prisma.$disconnect()];
                case 7:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
seed().catch(function (e) {
    console.error('Seed error:', e);
    process.exit(1);
});
