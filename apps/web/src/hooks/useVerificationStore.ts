"use client";

import { create } from "zustand";
import type { VerificationStep, VerificationStatus, GeoResult, DocumentResult, FaceResult, BreathResult } from "@/types/kyc";

const MAX_ATTEMPTS = 3;

interface VerificationState {
  sessionId: string | null;
  status: VerificationStatus;
  currentStep: VerificationStep;
  geoResult: GeoResult | null;
  documentResult: DocumentResult | null;
  faceResult: FaceResult | null;
  breathResult: BreathResult | null;
  overallScore: number | null;
  attempts: Record<VerificationStep, number>;

  setSessionId: (id: string) => void;
  setStatus: (status: VerificationStatus) => void;
  advanceStep: () => void;
  failStep: () => void;
  setGeoResult: (result: GeoResult) => void;
  setDocumentResult: (result: DocumentResult) => void;
  setFaceResult: (result: FaceResult) => void;
  setBreathResult: (result: BreathResult) => void;
  setOverallScore: (score: number) => void;
  reset: () => void;
}

const STEP_ORDER: readonly VerificationStep[] = ["geolocation", "document", "facial", "breath"];

const initialState = {
  sessionId: null,
  status: "idle" as VerificationStatus,
  currentStep: "geolocation" as VerificationStep,
  geoResult: null,
  documentResult: null,
  faceResult: null,
  breathResult: null,
  overallScore: null,
  attempts: { geolocation: 0, document: 0, facial: 0, breath: 0 },
};

export const useVerificationStore = create<VerificationState>((set, get) => ({
  ...initialState,

  setSessionId: (id) => set({ sessionId: id, status: "in_progress" }),

  setStatus: (status) => set({ status }),

  advanceStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      set({ currentStep: STEP_ORDER[currentIndex + 1] });
    } else {
      set({ status: "complete" });
    }
  },

  failStep: () => {
    const { currentStep, attempts } = get();
    const newAttempts = { ...attempts, [currentStep]: attempts[currentStep] + 1 };
    if (newAttempts[currentStep] >= MAX_ATTEMPTS) {
      set({ status: "failed", attempts: newAttempts });
    } else {
      set({ attempts: newAttempts });
    }
  },

  setGeoResult: (result) => set({ geoResult: result }),
  setDocumentResult: (result) => set({ documentResult: result }),
  setFaceResult: (result) => set({ faceResult: result }),
  setBreathResult: (result) => set({ breathResult: result }),
  setOverallScore: (score) => set({ overallScore: score }),

  reset: () => set(initialState),
}));
