/**
 * Decode for CV pipeline: EXIF rotate, fallbacks for odd encodings, then cap huge dimensions.
 */
export declare function normalizeImageBuffer(buffer: Buffer): Promise<Buffer>;
export type DocumentKind = 'CNH' | 'RG';
export type PixelBBox = {
    left: number;
    top: number;
    width: number;
    height: number;
};
/** Map cosine [-1,1] to a 0–100 “match” score (MVP heuristic). */
export declare function similarityToMatchPercent(cos: number): number;
/**
 * Portrait template from an already EXIF-normalized buffer (optionally rotated for upright document).
 * Use this when OCR picked a rotation so the crop matches readable layout.
 */
export declare function buildDocumentPortraitTemplateFromNormalized(normalized: Buffer, documentType: string): Promise<Float32Array>;
export declare function buildDocumentPortraitTemplate(buffer: Buffer, documentType: string): Promise<Float32Array>;
/** Live capture: face-centered crop (not full frame). */
export declare function buildLiveFaceTemplate(buffer: Buffer): Promise<Float32Array>;
/**
 * Compare document portrait template to live image. Uses face-sized crop + max(unflipped, mirrored)
 * so front-camera mirror mismatch does not always fail the match.
 */
export declare function matchDocumentTemplateToLive(docVec: Float32Array, liveImageBuffer: Buffer): Promise<number>;
export declare function templateToJson(vec: Float32Array): string;
export declare function templateFromJson(json: string): Float32Array;
export declare function compareTemplates(doc: Float32Array, live: Float32Array): number;
//# sourceMappingURL=faceMatch.d.ts.map