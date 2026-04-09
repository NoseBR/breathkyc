"use client";

import type { VerificationStep, StepStatus } from "@/types/kyc";
import { useVerificationStore } from "@/hooks/useVerificationStore";
import { clsx } from "clsx";

const STEP_LABELS: Record<VerificationStep, string> = {
  geolocation: "Location",
  document: "Document",
  facial: "Face",
  breath: "Breath",
};

const STEP_ORDER: readonly VerificationStep[] = ["geolocation", "document", "facial", "breath"];

interface StepIndicatorProps {
  steps: readonly VerificationStep[];
  currentStep: VerificationStep;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  const currentIndex = STEP_ORDER.indexOf(currentStep);

  function getStepStatus(step: VerificationStep): StepStatus {
    const stepIndex = STEP_ORDER.indexOf(step);
    if (stepIndex < currentIndex) return "complete";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  }

  return (
    <div className="flex items-center justify-between">
      {steps.map((step, i) => {
        const status = getStepStatus(step);
        return (
          <div key={step} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-2">
              <div
                className={clsx(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  status === "complete" && "bg-green-500/20 text-green-400",
                  status === "active" && "bg-breath-cyan/20 text-breath-cyan",
                  status === "pending" && "bg-gray-800 text-gray-500"
                )}
              >
                {status === "complete" ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={clsx(
                  "text-xs font-medium",
                  status === "complete" && "text-green-400",
                  status === "active" && "text-breath-cyan",
                  status === "pending" && "text-gray-500"
                )}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  "flex-1 h-px mx-4 mt-[-20px]",
                  status === "complete" ? "bg-green-500/50" : "bg-gray-800"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
