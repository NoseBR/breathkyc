export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StartVerificationResponse {
  sessionId: string;
  expiresAt: string;
}

export interface GeolocationResponse {
  allowed: boolean;
  country: string;
  region: string;
  vpnDetected: boolean;
}

export interface DocumentUploadResponse {
  name: string;
  cpf: string;
  dateOfBirth: string;
  documentNumber: string;
  ocrConfidence: number;
}

export interface FaceVerificationResponse {
  matchScore: number;
  livenessScore: number;
  passed: boolean;
}

export interface BreathVerificationResponse {
  audioScore: number;
  visualScore: number;
  correlationScore: number;
  totalScore: number;
  passed: boolean;
}

export interface VerificationResultResponse {
  sessionId: string;
  status: "PASSED" | "FAILED" | "PENDING" | "IN_PROGRESS" | "EXPIRED";
  overallScore: number;
  completedAt: string | null;
}
