import { createWorker, type Worker } from 'tesseract.js';
import sharp from 'sharp';
import { normalizeImageBuffer } from '../../lib/faceMatch';
import { isValidCpf, parseBrazilianIdFields } from '../../lib/brazilIdParse';

let workerPromise: Promise<Worker> | null = null;

/**
 * Single long-lived worker (first request downloads por+eng traineddata via CDN).
 * Set TESSERACT_DEBUG=true to log progress.
 */
export async function getTesseractWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('por+eng', 1, {
      logger: (m) => {
        if (process.env.TESSERACT_DEBUG === 'true') {
          console.log('[tesseract]', m.status, m.progress ?? '');
        }
      },
    });
  }
  return workerPromise;
}

const sharpLoose: sharp.SharpOptions = { failOn: 'none' };

const OCR_MAX_DIM = 2600;

/** Grayscale + resize from an already decoded/normalized raster (no EXIF pass). */
export async function preprocessForOcrFromDecoded(decoded: Buffer): Promise<Buffer> {
  const meta = await sharp(decoded, sharpLoose).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  let pipeline = sharp(decoded, sharpLoose);
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
export async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  const decoded = await normalizeImageBuffer(buffer);
  return preprocessForOcrFromDecoded(decoded);
}

function confidenceFromText(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const letters = (t.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
  const ratio = letters / Math.max(t.length, 1);
  return Math.round(Math.min(90, 35 + ratio * 50));
}

function tesseractConfidence(data: { confidence?: number }, text: string): number {
  let confidence =
    typeof data.confidence === 'number' && !Number.isNaN(data.confidence) && data.confidence > 0
      ? Math.min(100, Math.round(data.confidence))
      : confidenceFromText(text);
  if (text.length < 25) confidence = Math.min(confidence, 55);
  return confidence;
}

function badHolderNameGuess(name: string): boolean {
  return /^(BR\s|REP[ÚU]BLICA|REPUBLICA|MINIST|FEDERAT|DEPART|CARTEIRA)/i.test(name.trim());
}

/**
 * Pick best of 0/90/180/270° (after EXIF) so sideways desk photos still OCR.
 */
function scoreOrientationCandidate(text: string, tesseractConf: number): number {
  const parsed = parseBrazilianIdFields(text);
  let score = 0;
  if (isValidCpf(parsed.cpf)) score += 55;
  else {
    const d = parsed.cpf.replace(/\D/g, '');
    if (d.length === 11) score += 12;
  }
  if (parsed.name.trim().length >= 6 && !badHolderNameGuess(parsed.name)) score += 22;
  if (/nome|filiaç|filiacao|doc\.?\s*ident|cpf\b|cnh\b|nacionalidade|categoria|habilit/i.test(text)) {
    score += 12;
  }
  if (parsed.dateOfBirth) score += 10;
  if (parsed.documentNumber.replace(/\D/g, '').length >= 6) score += 10;
  score += tesseractConf * 0.2;
  score += Math.min(12, text.length / 150);
  return score;
}

async function rotateNormalized(normalized: Buffer, angle: 0 | 90 | 180 | 270): Promise<Buffer> {
  if (angle === 0) return normalized;
  return sharp(normalized, sharpLoose)
    .rotate(angle, { background: { r: 255, g: 255, b: 255 } })
    .toBuffer();
}

export type OcrOutput = {
  text: string;
  confidence: number;
};

export type OcrWithOrientation = OcrOutput & {
  /** Extra clockwise rotation applied after EXIF auto-orient (0 = already upright). */
  orientationDegrees: number;
  /** Decoded + rotated buffer — use for portrait crop so face region matches OCR. */
  orientedDecoded: Buffer;
};

export async function runTesseractOcr(imageBuffer: Buffer): Promise<OcrOutput> {
  const out = await runTesseractOcrWithBestOrientation(imageBuffer);
  return { text: out.text, confidence: out.confidence };
}

export async function runTesseractOcrWithBestOrientation(
  imageBuffer: Buffer
): Promise<OcrWithOrientation> {
  const normalized = await normalizeImageBuffer(imageBuffer);
  const angles: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
  const worker = await getTesseractWorker();

  let bestScore = -Infinity;
  let best = {
    text: '',
    confidence: 0,
    angle: 0 as 0 | 90 | 180 | 270,
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
