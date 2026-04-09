import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
import type { PixelBBox } from './faceMatch';

const FeatureType = protos.google.cloud.vision.v1.Feature.Type;

let client: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient | null {
  if (process.env.VISION_OCR_ENABLED === 'false') return null;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCLOUD_PROJECT) {
    return null;
  }
  try {
    if (!client) client = new ImageAnnotatorClient();
    return client;
  } catch (e) {
    console.warn('Vision client init failed:', e);
    return null;
  }
}

export function isVisionOcrEnabled(): boolean {
  return getVisionClient() !== null;
}

function verticesToBox(
  vertices: protos.google.cloud.vision.v1.IVertex[] | null | undefined
): PixelBBox | null {
  if (!vertices?.length) return null;
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;
  if (width < 4 || height < 4) return null;
  return { left, top, width, height };
}

function pickBestFace(
  faces: protos.google.cloud.vision.v1.IFaceAnnotation[] | null | undefined
): PixelBBox | null {
  if (!faces?.length) return null;
  let best: PixelBBox | null = null;
  let bestArea = 0;
  for (const f of faces) {
    const conf = f.detectionConfidence ?? 0;
    if (conf < 0.35) continue;
    const poly = f.boundingPoly?.vertices ?? f.fdBoundingPoly?.vertices;
    const box = verticesToBox(poly);
    if (!box) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      best = box;
    }
  }
  return best;
}

function avgPageConfidence(
  full: { pages?: protos.google.cloud.vision.v1.IPage[] | null } | null | undefined
): number {
  const pages = full?.pages;
  if (!pages?.length) return 0;
  let sum = 0;
  let n = 0;
  for (const p of pages) {
    if (p.confidence != null && p.confidence > 0) {
      sum += p.confidence;
      n++;
    }
  }
  if (!n) return 0;
  return Math.round((sum / n) * 100);
}

export type DocumentVisionResult = {
  fullText: string;
  documentFaceBox: PixelBBox | null;
  ocrConfidence: number;
};

export async function analyzeDocumentImage(buffer: Buffer): Promise<DocumentVisionResult | null> {
  const c = getVisionClient();
  if (!c) return null;

  const [batch] = await c.batchAnnotateImages({
    requests: [
      {
        image: { content: buffer },
        features: [
          { type: FeatureType.DOCUMENT_TEXT_DETECTION },
          { type: FeatureType.FACE_DETECTION, maxResults: 10 },
        ],
      },
    ],
  });

  const resp = batch.responses?.[0];
  if (!resp) return null;
  if (resp.error?.message) {
    console.warn('Vision API error:', resp.error.message);
    return null;
  }

  const fullText = resp.fullTextAnnotation?.text?.trim() ?? '';
  const ocrConfidence = avgPageConfidence(resp.fullTextAnnotation) || (fullText.length > 40 ? 85 : 60);
  const documentFaceBox = pickBestFace(resp.faceAnnotations);

  return { fullText, documentFaceBox, ocrConfidence };
}

export async function detectLiveFaceBox(buffer: Buffer): Promise<PixelBBox | null> {
  const c = getVisionClient();
  if (!c) return null;
  const [batch] = await c.batchAnnotateImages({
    requests: [
      {
        image: { content: buffer },
        features: [{ type: FeatureType.FACE_DETECTION, maxResults: 5 }],
      },
    ],
  });
  const resp = batch.responses?.[0];
  if (resp?.error?.message) {
    console.warn('Vision face error:', resp.error.message);
    return null;
  }
  return pickBestFace(resp?.faceAnnotations);
}
