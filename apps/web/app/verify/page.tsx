"use client";

import { useEffect, useState } from "react";
import GeolocationStep from "./components/GeolocationStep";
import FacialStep from "./components/FacialStep";
import BreathStep from "./components/BreathStep";
import ProgressBar from "./components/ProgressBar";
import InsecureContextBanner from "./components/InsecureContextBanner";
import { apiPost } from "../../lib/api";
import { Loader2, ShieldX, CheckCircle } from "lucide-react";

type StepState = "geolocation" | "face" | "breath" | "complete" | "failed";

export default function VerifyPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<StepState>("geolocation");
  const [failReason, setFailReason] = useState<string>("");

  useEffect(() => {
    async function initSession() {
      try {
        const res = await apiPost("/v1/verify/start");
        const data = await res.json();
        if (data.sessionId) setSessionId(data.sessionId);
        else setError("Failed to initialize session");
      } catch (e) {
        setError("Network error starting verification");
      }
    }
    initSession();
  }, []);

  const handleFail = (reason: string) => {
    setFailReason(reason);
    setCurrentStep("failed");
  };

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-zinc-500">Initializing secure session...</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-center mb-4 px-4">
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            BreathKYC
          </h1>
        </div>

        {/* Progress Bar */}
        {currentStep !== "complete" && currentStep !== "failed" && (
          <ProgressBar currentStep={currentStep} />
        )}

        {(currentStep === "face" || currentStep === "breath") && (
          <InsecureContextBanner />
        )}

        {/* Steps */}
        {currentStep === "geolocation" && (
          <GeolocationStep
            sessionId={sessionId}
            onSuccess={() => setCurrentStep("face")}
            onFail={handleFail}
          />
        )}

        {currentStep === "face" && (
          <FacialStep
            sessionId={sessionId}
            onSuccess={() => setCurrentStep("breath")}
            onFail={handleFail}
          />
        )}

        {currentStep === "breath" && (
          <BreathStep
            sessionId={sessionId}
            onSuccess={() => setCurrentStep("complete")}
            onFail={handleFail}
          />
        )}

        {/* Completion Screen */}
        {currentStep === "complete" && (
          <div className="w-full max-w-md mx-auto p-8 bg-zinc-900 border border-primary/30 text-center rounded-2xl shadow-[0_0_40px_rgba(0,229,255,0.15)]">
            <CheckCircle className="w-16 h-16 text-primary mx-auto mb-4" />
            <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent mb-3">
              KYC Complete
            </h2>
            <p className="text-zinc-400 mb-2 text-sm">
              Congratulations! You have successfully passed the world&apos;s first Breath-Based Liveness Verification.
            </p>
            <p className="text-zinc-600 text-xs mb-6">
              Session: <span className="font-mono text-zinc-500">{sessionId.slice(0, 16)}...</span>
            </p>
            <button
              onClick={() => window.location.href = 'https://breath-protocol.vercel.app/dashboard'}
              className="w-full h-12 flex items-center justify-center bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition"
            >
              Return to Dashboard
            </button>
          </div>
        )}

        {/* Failure Screen */}
        {currentStep === "failed" && (
          <div className="w-full max-w-md mx-auto p-8 bg-zinc-900 border border-error/30 text-center rounded-2xl shadow-[0_0_40px_rgba(255,61,127,0.1)]">
            <ShieldX className="w-16 h-16 text-error mx-auto mb-4" />
            <h2 className="text-2xl font-black text-error mb-3">
              Verification Failed
            </h2>
            <p className="text-zinc-400 mb-6 text-sm">
              {failReason || "An error occurred during the verification process."}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full h-12 flex items-center justify-center bg-error/20 text-error font-bold rounded-xl hover:bg-error/30 transition border border-error/30"
            >
              Restart Verification
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
