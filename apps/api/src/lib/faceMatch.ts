import sharp from 'sharp';

const TEMPLATE_SIZE = 48;

/** Be tolerant of phone JPEGs; allow large scans (multer still caps file size). */
const sharpLoose: sharp.SharpOptions = {
  failOn: 'none',
  limitInputPixels: false,
};

const MAX_DECODE_SIDE = 8192;
const MAX_DECODE_PIXELS = 50_000_000;

async function tryDecode(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, sharpLoose).rotate().toBuffer();
}

/**
 * Decode for CV pipeline: EXIF rotate, fallbacks for odd encodings, then cap huge dimensions.
 */
export async function normalizeImageBuffer(buffer: Buffer): Promise<Buffer> {
  const decoded = await decodeOnly(buffer);
  return capDecodedImageSize(decoded);
}

async function decodeOnly(buffer: Buffer): Promise<Buffer> {
  if (!buffer?.length) throw new Error('Empty image buffer');

  try {
    return await tryDecode(buffer);
  } catch (first) {
    try {
      return await sharp(buffer, sharpLoose)
        .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer()
        .then((b) => tryDecode(b));
    } catch {
      try {
        return await sharp(buffer, sharpLoose)
          .ensureAlpha()
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: 92 })
          .toBuffer()
          .then((b) => tryDecode(b));
      } catch (e) {
        const msg = first instanceof Error ? first.message : String(first);
        throw new Error(`Could not decode image for processing: ${msg}`);
      }
    }
  }
}

/** Downscale very large decoded buffers so extract/resize stays within libvips/thread limits. */
async function capDecodedImageSize(buf: Buffer): Promise<Buffer> {
  const meta = await sharp(buf, sharpLoose).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 16 || h < 16) return buf;
  const pixels = w * h;
  const maxSide = Math.max(w, h);
  if (maxSide <= MAX_DECODE_SIDE && pixels <= MAX_DECODE_PIXELS) return buf;

  return sharp(buf, sharpLoose)
    .resize(MAX_DECODE_SIDE, MAX_DECODE_SIDE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

export type DocumentKind = 'CNH' | 'RG';

export type PixelBBox = { left: number; top: number; width: number; height: number };

function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const inv = sum > 1e-12 ? 1 / Math.sqrt(sum) : 0;
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
  return vec;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/** Map cosine [-1,1] to a 0–100 “match” score (MVP heuristic). */
export function similarityToMatchPercent(cos: number): number {
  const t = (cos + 1) / 2;
  return Math.round(Math.min(100, Math.max(0, t * 100)));
}

async function rawGrayscaleVectorFromNormalized(
  normalized: Buffer,
  crop?: { left: number; top: number; width: number; height: number }
): Promise<Float32Array> {
  const meta = await sharp(normalized, sharpLoose).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 16 || h < 16) throw new Error('Image too small');

  let pipeline = sharp(normalized, sharpLoose);
  if (crop) {
    const left = Math.max(0, Math.floor(crop.left));
    const top = Math.max(0, Math.floor(crop.top));
    const width = Math.min(w - left, Math.floor(crop.width));
    const height = Math.min(h - top, Math.floor(crop.height));
    if (width < 8 || height < 8) throw new Error('Crop invalid');
    pipeline = pipeline.extract({ left, top, width, height });
  }

  const { data, info } = await pipeline
    .resize(TEMPLATE_SIZE, TEMPLATE_SIZE, { fit: 'cover' })
    .grayscale()
    .raw({ depth: 'uchar' })
    .toBuffer({ resolveWithObject: true });

  const pixels = info.width * info.height;
  const ch = (info.channels ?? 1) as number;
  if (!Number.isFinite(pixels) || pixels <= 0) throw new Error('Invalid raw dimensions');
  if (data.length < pixels * ch) throw new Error('Raw buffer size mismatch');

  const out = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    let v: number;
    if (ch === 1) {
      v = data[i]!;
    } else if (ch >= 3) {
      const o = i * ch;
      v = 0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!;
    } else {
      v = data[i * ch]!;
    }
    if (!Number.isFinite(v)) v = 0;
    out[i] = Math.min(255, Math.max(0, v)) / 255;
  }

  let mean = 0;
  for (let i = 0; i < out.length; i++) mean += out[i];
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] -= mean;
  return l2Normalize(out);
}

/** Portrait-heavy crop for Brazilian-style CNH (photo on the left). */
function cnhPortraitCrop(w: number, h: number) {
  return {
    left: w * 0.04,
    top: h * 0.12,
    width: w * 0.38,
    height: h * 0.76,
  };
}

/** Portrait-heavy crop for vertical RG-style layout (photo upper band). */
function rgPortraitCrop(w: number, h: number) {
  return {
    left: w * 0.18,
    top: h * 0.06,
    width: w * 0.64,
    height: h * 0.42,
  };
}

/**
 * Selfie / webcam: face is usually upper-middle. Tight crop aligns embedding space with CNH portrait strip.
 */
function liveSelfiePortraitCrop(w: number, h: number): { left: number; top: number; width: number; height: number } {
  const side = Math.floor(Math.min(w, h) * 0.7);
  const left = Math.max(0, Math.floor((w - side) / 2));
  const topCenter = (h - side) / 2;
  const top = Math.max(0, Math.floor(topCenter - h * 0.07));
  const height = Math.min(side, h - top);
  const width = Math.min(side, w - left);
  return { left, top, width, height };
}

/**
 * Portrait template from an already EXIF-normalized buffer (optionally rotated for upright document).
 * Use this when OCR picked a rotation so the crop matches readable layout.
 */
export async function buildDocumentPortraitTemplateFromNormalized(
  normalized: Buffer,
  documentType: string
): Promise<Float32Array> {
  const meta = await sharp(normalized, sharpLoose).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 16 || h < 16) throw new Error('Image too small');

  const kind: DocumentKind = documentType === 'RG' ? 'RG' : 'CNH';
  const crop = kind === 'RG' ? rgPortraitCrop(w, h) : cnhPortraitCrop(w, h);
  try {
    return await rawGrayscaleVectorFromNormalized(normalized, crop);
  } catch {
    return await rawGrayscaleVectorFromNormalized(normalized);
  }
}

export async function buildDocumentPortraitTemplate(
  buffer: Buffer,
  documentType: string
): Promise<Float32Array> {
  const normalized = await normalizeImageBuffer(buffer);
  return buildDocumentPortraitTemplateFromNormalized(normalized, documentType);
}

/** Live capture: face-centered crop (not full frame). */
export async function buildLiveFaceTemplate(buffer: Buffer): Promise<Float32Array> {
  const normalized = await normalizeImageBuffer(buffer);
  const meta = await sharp(normalized, sharpLoose).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 16 || h < 16) throw new Error('Image too small');
  const crop = liveSelfiePortraitCrop(w, h);
  try {
    return await rawGrayscaleVectorFromNormalized(normalized, crop);
  } catch {
    return rawGrayscaleVectorFromNormalized(normalized);
  }
}

/**
 * Compare document portrait template to live image. Uses face-sized crop + max(unflipped, mirrored)
 * so front-camera mirror mismatch does not always fail the match.
 */
export async function matchDocumentTemplateToLive(docVec: Float32Array, liveImageBuffer: Buffer): Promise<number> {
  const normalized = await normalizeImageBuffer(liveImageBuffer);
  const meta = await sharp(normalized, sharpLoose).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 16 || h < 16) return 0;

  async function vecFrom(buf: Buffer): Promise<Float32Array> {
    const m = await sharp(buf, sharpLoose).metadata();
    const ww = m.width ?? 0;
    const hh = m.height ?? 0;
    const crop = liveSelfiePortraitCrop(ww, hh);
    try {
      return await rawGrayscaleVectorFromNormalized(buf, crop);
    } catch {
      return rawGrayscaleVectorFromNormalized(buf);
    }
  }

  const liveA = await vecFrom(normalized);
  const flipped = await sharp(normalized, sharpLoose).flop().toBuffer();
  const liveB = await vecFrom(flipped);

  const s1 = similarityToMatchPercent(cosineSimilarity(docVec, liveA));
  const s2 = similarityToMatchPercent(cosineSimilarity(docVec, liveB));
  return Math.max(s1, s2);
}

export function templateToJson(vec: Float32Array): string {
  return JSON.stringify(Array.from(vec));
}

export function templateFromJson(json: string): Float32Array {
  const arr = JSON.parse(json) as number[];
  return Float32Array.from(arr);
}

export function compareTemplates(doc: Float32Array, live: Float32Array): number {
  if (doc.length !== live.length) return 0;
  return similarityToMatchPercent(cosineSimilarity(doc, live));
}
