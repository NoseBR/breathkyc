"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTesseractWorker = getTesseractWorker;
exports.preprocessForOcrFromDecoded = preprocessForOcrFromDecoded;
exports.preprocessForOcr = preprocessForOcr;
exports.runTesseractOcr = runTesseractOcr;
exports.runTesseractOcrWithBestOrientation = runTesseractOcrWithBestOrientation;
const tesseract_js_1 = require("tesseract.js");
const sharp_1 = __importDefault(require("sharp"));
const faceMatch_1 = require("../../lib/faceMatch");
const brazilIdParse_1 = require("../../lib/brazilIdParse");
let workerPromise = null;
/**
 * Single long-lived worker (first request downloads por+eng traineddata via CDN).
 * Set TESSERACT_DEBUG=true to log progress.
 */
async function getTesseractWorker() {
    if (!workerPromise) {
        workerPromise = (0, tesseract_js_1.createWorker)('por+eng', 1, {
            logger: (m) => {
                if (process.env.TESSERACT_DEBUG === 'true') {
                    console.log('[tesseract]', m.status, m.progress ?? '');
                }
            },
        });
    }
    return workerPromise;
}
const sharpLoose = { failOn: 'none' };
const OCR_MAX_DIM = 2600;
/** Grayscale + resize from an already decoded/normalized raster (no EXIF pass). */
async function preprocessForOcrFromDecoded(decoded) {
    const meta = await (0, sharp_1.default)(decoded, sharpLoose).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    let pipeline = (0, sharp_1.default)(decoded, sharpLoose);
    if (w > OCR_MAX_DIM || h > OCR_MAX_DIM) {
        pipeline = pipeline.resize({
            width: w >= h ? OCR_MAX_DIM : undefined,
            height: h > w ? OCR_MAX_DIM : undefined,
            fit: 'inside',
        });
    }
    // CNH security patterns + glare: mild sharpen + contrast help Tesseract on small digits.
    return pipeline
        .grayscale()
        .normalize()
        .linear(1.08, -(0.08 * 128) + 2)
        .sharpen({ sigma: 1, m1: 0.5, m2: 3 })
        .toBuffer();
}
/** Same decode path as portrait pipeline, then grayscale for Tesseract. */
async function preprocessForOcr(buffer) {
    const decoded = await (0, faceMatch_1.normalizeImageBuffer)(buffer);
    return preprocessForOcrFromDecoded(decoded);
}
function confidenceFromText(text) {
    const t = text.trim();
    if (!t)
        return 0;
    const letters = (t.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    const ratio = letters / Math.max(t.length, 1);
    return Math.round(Math.min(90, 35 + ratio * 50));
}
function tesseractConfidence(data, text) {
    let confidence = typeof data.confidence === 'number' && !Number.isNaN(data.confidence) && data.confidence > 0
        ? Math.min(100, Math.round(data.confidence))
        : confidenceFromText(text);
    if (text.length < 25)
        confidence = Math.min(confidence, 55);
    return confidence;
}
function badHolderNameGuess(name) {
    return /^(BR\s|REP[ÚU]BLICA|REPUBLICA|MINIST|FEDERAT|DEPART|CARTEIRA)/i.test(name.trim());
}
/**
 * Pick best of 0/90/180/270° (after EXIF) so sideways desk photos still OCR.
 */
function scoreOrientationCandidate(text, tesseractConf) {
    const parsed = (0, brazilIdParse_1.parseBrazilianIdFields)(text);
    let score = 0;
    if ((0, brazilIdParse_1.isValidCpf)(parsed.cpf))
        score += 55;
    else {
        const d = parsed.cpf.replace(/\D/g, '');
        if (d.length === 11)
            score += 12;
    }
    if (parsed.name.trim().length >= 6 && !badHolderNameGuess(parsed.name))
        score += 22;
    if (/nome|filiaç|filiacao|doc\.?\s*ident|cpf\b|cnh\b|nacionalidade|categoria|habilit/i.test(text)) {
        score += 12;
    }
    if (parsed.dateOfBirth)
        score += 10;
    if (parsed.documentNumber.replace(/\D/g, '').length >= 6)
        score += 10;
    score += tesseractConf * 0.2;
    score += Math.min(12, text.length / 150);
    return score;
}
async function rotateNormalized(normalized, angle) {
    if (angle === 0)
        return normalized;
    return (0, sharp_1.default)(normalized, sharpLoose)
        .rotate(angle, { background: { r: 255, g: 255, b: 255 } })
        .toBuffer();
}
async function runTesseractOcr(imageBuffer) {
    const out = await runTesseractOcrWithBestOrientation(imageBuffer);
    return { text: out.text, confidence: out.confidence };
}
async function runTesseractOcrWithBestOrientation(imageBuffer) {
    const normalized = await (0, faceMatch_1.normalizeImageBuffer)(imageBuffer);
    const angles = [0, 90, 180, 270];
    const worker = await getTesseractWorker();
    let bestScore = -Infinity;
    let best = {
        text: '',
        confidence: 0,
        angle: 0,
    };
    for (const angle of angles) {
        const rotated = await rotateNormalized(normalized, angle);
        const prepared = await preprocessForOcrFromDecoded(rotated);
        const { data } = await worker.recognize(prepared, {}, { text: true });
        const text = (data.text ?? '').trim();
        const confidence = tesseractConfidence(data, text);
        const score = scoreOrientationCandidate(text, confidence);
        if (process.env.TESSERACT_DEBUG === 'true') {
            console.log('[tesseract] try angle', angle, 'score', score.toFixed(1), 'conf', confidence);
        }
        if (score > bestScore) {
            bestScore = score;
            best = { text, confidence, angle };
        }
    }
    const orientedDecoded = await rotateNormalized(normalized, best.angle);
    return {
        text: best.text,
        confidence: best.confidence,
        orientationDegrees: best.angle,
        orientedDecoded,
    };
}
//# sourceMappingURL=tesseractOcr.js.map