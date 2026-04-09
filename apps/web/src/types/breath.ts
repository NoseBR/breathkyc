export interface BreathPattern {
  inhaleStart: number;
  inhaleEnd: number;
  holdStart: number;
  holdEnd: number;
  exhaleStart: number;
  exhaleEnd: number;
}

export interface AudioFeatures {
  energyTimeline: number[];
  spectralSnapshots: number[][];
  breathPattern: BreathPattern;
  overallScore: number;
}

export interface VisualFeatures {
  mouthOpenTimeline: number[];
  shoulderTimeline: number[];
  nostrilTimeline: number[];
  cheekTimeline: number[];
  overallScore: number;
}

export interface BreathAnalysisResult {
  audioFeatures: AudioFeatures;
  visualFeatures: VisualFeatures;
  correlationScore: number;
  totalScore: number;
}

export type BreathDetectionState =
  | "idle"
  | "listening"
  | "inhale_detected"
  | "hold_detected"
  | "exhale_detected"
  | "validated"
  | "failed";

export type BreathGuidePhase =
  | "ready"
  | "inhale"
  | "hold"
  | "exhale"
  | "processing"
  | "result";
