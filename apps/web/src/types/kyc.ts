export type VerificationStep = "geolocation" | "document" | "facial" | "breath";

export type VerificationStatus = "idle" | "in_progress" | "complete" | "failed";

export type StepStatus = "pending" | "active" | "complete" | "failed";

export interface GeoResult {
  latitude: number;
  longitude: number;
  country: string;
  region: string;
  vpnDetected: boolean;
  allowed: boolean;
}

export interface DocumentResult {
  documentType: "rg" | "cnh" | "passport";
  name: string;
  cpf: string;
  dateOfBirth: string;
  documentNumber: string;
  ocrConfidence: number;
}

export interface FaceResult {
  matchScore: number;
  livenessScore: number;
  passed: boolean;
}

export interface BreathResult {
  audioScore: number;
  visualScore: number;
  correlationScore: number;
  totalScore: number;
  passed: boolean;
}

export interface VerificationSession {
  sessionId: string;
  status: VerificationStatus;
  currentStep: VerificationStep;
  geoResult?: GeoResult;
  documentResult?: DocumentResult;
  faceResult?: FaceResult;
  breathResult?: BreathResult;
  overallScore?: number;
  attempts: Record<VerificationStep, number>;
}
