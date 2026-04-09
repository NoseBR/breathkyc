/** Heuristic extraction from OCR text (Brazilian CNH/RG-style blobs). */
export type ExtractedIdFields = {
    name: string;
    cpf: string;
    dateOfBirth: string;
    documentNumber: string;
};
export declare function parseBrazilianIdFields(text: string): ExtractedIdFields;
/** Brazilian CPF check digits (returns false for known invalid patterns). */
export declare function isValidCpf(formattedOrRaw: string): boolean;
/** Basic sanity checks for confirm step (MVP). */
export declare function validateConfirmedDocumentFields(fields: ExtractedIdFields): string | null;
//# sourceMappingURL=brazilIdParse.d.ts.map