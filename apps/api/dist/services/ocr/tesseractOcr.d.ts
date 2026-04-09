import { type Worker } from 'tesseract.js';
/**
 * Single long-lived worker (first request downloads por+eng traineddata via CDN).
 * Set TESSERACT_DEBUG=true to log progress.
 */
export declare function getTesseractWorker(): Promise<Worker>;
/** Grayscale + resize from an already decoded/normalized raster (no EXIF pass). */
export declare function preprocessForOcrFromDecoded(decoded: Buffer): Promise<Buffer>;
/** Same decode path as portrait pipeline, then grayscale for Tesseract. */
export declare function preprocessForOcr(buffer: Buffer): Promise<Buffer>;
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
export declare function runTesseractOcr(imageBuffer: Buffer): Promise<OcrOutput>;
export declare function runTesseractOcrWithBestOrientation(imageBuffer: Buffer): Promise<OcrWithOrientation>;
//# sourceMappingURL=tesseractOcr.d.ts.map