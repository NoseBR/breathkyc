"use client";

import { motion } from "framer-motion";

const STEPS = [
  { key: "geolocation", label: "Location" },
  { key: "document", label: "Document" },
  { key: "face", label: "Face" },
  { key: "breath", label: "Breath" },
];

interface ProgressBarProps {
  currentStep: string;
}

export default function ProgressBar({ currentStep }: ProgressBarProps) {
  const stepOrder = STEPS.map(s => s.key);
  const currentIndex = stepOrder.indexOf(currentStep);
  // If complete or failed, show all filled or special state
  const activeIndex = currentStep === "complete" ? STEPS.length : currentStep === "failed" ? -1 : currentIndex;

  return (
    <div className="w-full flex items-center gap-1 mb-8 px-2">
      {STEPS.map((step, i) => {
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;

        return (
          <div key={step.key} className="flex-1 flex flex-col items-center gap-1.5">
            {/* Bar segment */}
            <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: "0%" }}
                animate={{
                  width: isCompleted || isActive ? "100%" : "0%",
                  backgroundColor: isCompleted
                    ? "#00E5FF"
                    : isActive
                    ? "#B24BF3"
                    : "#27272a",
                }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
              />
            </div>
            {/* Label */}
            <span
              className={`text-[10px] tracking-wider uppercase font-semibold transition-colors ${
                isCompleted
                  ? "text-primary"
                  : isActive
                  ? "text-accent"
                  : "text-zinc-600"
              }`}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
