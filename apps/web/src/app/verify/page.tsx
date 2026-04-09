"use client";

import { StepIndicator } from "./components/StepIndicator";
import { GeolocationStep } from "./components/GeolocationStep";
import { DocumentStep } from "./components/DocumentStep";
import { FacialStep } from "./components/FacialStep";
import { BreathStep } from "./components/BreathStep";
import { useVerificationStore } from "@/hooks/useVerificationStore";

const STEPS = ["geolocation", "document", "facial", "breath"] as const;

export default function VerifyPage() {
  const { currentStep, status } = useVerificationStore();

  if (status === "complete") {
    return <CompletionScreen />;
  }

  if (status === "failed") {
    return <FailedScreen />;
  }

  return (
    <div className="space-y-8">
      <StepIndicator steps={STEPS} currentStep={currentStep} />
      <div className="min-h-[400px]">
        {currentStep === "geolocation" && <GeolocationStep />}
        {currentStep === "document" && <DocumentStep />}
        {currentStep === "facial" && <FacialStep />}
        {currentStep === "breath" && <BreathStep />}
      </div>
    </div>
  );
}

function CompletionScreen() {
  const { sessionId, overallScore } = useVerificationStore();

  return (
    <div className="text-center space-y-6 py-16">
      <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
        <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-3xl font-bold text-green-400">Verified</h2>
      <p className="text-gray-400">Identity verification completed successfully.</p>
      <div className="inline-block bg-breath-card rounded-xl p-6 space-y-2 text-left">
        <div className="text-sm text-gray-500">Verification ID</div>
        <div className="font-mono text-sm">{sessionId}</div>
        <div className="text-sm text-gray-500 pt-2">Trust Score</div>
        <div className="text-2xl font-bold gradient-text">{overallScore}/100</div>
      </div>
    </div>
  );
}

function FailedScreen() {
  const { reset } = useVerificationStore();

  return (
    <div className="text-center space-y-6 py-16">
      <div className="w-20 h-20 mx-auto rounded-full bg-breath-rose/20 flex items-center justify-center">
        <svg className="w-10 h-10 text-breath-rose" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h2 className="text-3xl font-bold text-breath-rose">Verification Failed</h2>
      <p className="text-gray-400">We were unable to verify your identity. Please try again.</p>
      <button
        onClick={reset}
        className="px-8 py-3 rounded-xl bg-gradient-to-r from-breath-cyan to-breath-violet text-black font-semibold hover:opacity-90 transition-opacity"
      >
        Start Over
      </button>
    </div>
  );
}
