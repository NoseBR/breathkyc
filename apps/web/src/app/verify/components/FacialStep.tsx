"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useVerificationStore } from "@/hooks/useVerificationStore";
import { api } from "@/lib/api";

type FaceState = "setup" | "detecting" | "countdown" | "captured" | "processing" | "success" | "error";

interface LivenessChecks {
  blinkDetected: boolean;
  microMovement: boolean;
  depthVariation: boolean;
  consistentTexture: boolean;
}

export function FacialStep() {
  const [state, setState] = useState<FaceState>("setup");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("Initializing camera...");
  const [countdown, setCountdown] = useState(3);
  const [livenessChecks, setLivenessChecks] = useState<LivenessChecks>({
    blinkDetected: false,
    microMovement: false,
    depthVariation: false,
    consistentTexture: false,
  });
  const [matchScore, setMatchScore] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { sessionId, setFaceResult, advanceStep, failStep } = useVerificationStore();

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setState("detecting");
      setFeedback("Position your face in the oval guide");
    } catch {
      setError("Camera access denied. Please allow camera access and try again.");
      setState("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Simulate face detection and liveness (MediaPipe integration in Phase B)
  useEffect(() => {
    if (state !== "detecting") return;

    const timers: NodeJS.Timeout[] = [];

    // Simulate progressive liveness checks
    timers.push(
      setTimeout(() => {
        setFeedback("Face detected — hold still");
        setLivenessChecks((prev) => ({ ...prev, consistentTexture: true }));
      }, 1500)
    );

    timers.push(
      setTimeout(() => {
        setLivenessChecks((prev) => ({ ...prev, depthVariation: true }));
      }, 2500)
    );

    timers.push(
      setTimeout(() => {
        setFeedback("Checking for natural movement...");
        setLivenessChecks((prev) => ({ ...prev, microMovement: true }));
      }, 3500)
    );

    timers.push(
      setTimeout(() => {
        setLivenessChecks((prev) => ({ ...prev, blinkDetected: true }));
        setState("countdown");
      }, 4500)
    );

    return () => timers.forEach(clearTimeout);
  }, [state]);

  // Countdown timer
  useEffect(() => {
    if (state !== "countdown") return;

    if (countdown <= 0) {
      captureFrame();
      return;
    }

    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [state, countdown]);

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);

    canvas.toBlob(
      async (blob) => {
        if (!blob || !sessionId) return;
        setState("processing");
        stopCamera();

        const livenessScore = calculateLivenessScore(livenessChecks);
        const file = new File([blob], "face.jpg", { type: "image/jpeg" });

        const res = await api.submitFace(sessionId, file, livenessScore);

        if (!res.success || !res.data) {
          setError(res.error ?? "Face verification failed.");
          setState("error");
          failStep();
          return;
        }

        const data = res.data as { matchScore: number; livenessScore: number; passed: boolean };
        setMatchScore(data.matchScore);

        if (!data.passed) {
          setError("Face match score too low. Please try again.");
          setState("error");
          failStep();
          return;
        }

        setFaceResult({
          matchScore: data.matchScore,
          livenessScore: data.livenessScore,
          passed: data.passed,
        });
        setState("success");
      },
      "image/jpeg",
      0.92
    );
  }, [sessionId, livenessChecks, stopCamera, setFaceResult, failStep]);

  const retake = useCallback(() => {
    setError(null);
    setMatchScore(null);
    setCountdown(3);
    setLivenessChecks({ blinkDetected: false, microMovement: false, depthVariation: false, consistentTexture: false });
    startCamera();
  }, [startCamera]);

  return (
    <Card glow className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 mx-auto rounded-full bg-breath-cyan/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-breath-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Face Verification</h2>
        <p className="text-sm text-gray-400">{feedback}</p>
      </div>

      {error && (
        <div className="bg-breath-rose/10 border border-breath-rose/30 rounded-xl p-4 text-sm text-breath-rose">
          {error}
        </div>
      )}

      {/* Camera Feed */}
      {(state === "detecting" || state === "countdown") && (
        <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4] max-h-[400px] mx-auto">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {/* Oval guide */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-48 h-64 border-2 border-breath-cyan/60 rounded-[50%]" />
          </div>
          {/* Countdown overlay */}
          {state === "countdown" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-6xl font-bold text-breath-cyan">{countdown}</span>
            </div>
          )}
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {/* Liveness Checks */}
      {(state === "detecting" || state === "countdown") && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { key: "blinkDetected", label: "Blink detected" },
            { key: "microMovement", label: "Natural movement" },
            { key: "depthVariation", label: "3D depth" },
            { key: "consistentTexture", label: "Texture check" },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded-full flex items-center justify-center ${
                livenessChecks[key as keyof LivenessChecks]
                  ? "bg-green-500/20 text-green-400"
                  : "bg-gray-800 text-gray-600"
              }`}>
                {livenessChecks[key as keyof LivenessChecks] ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </div>
              <span className={livenessChecks[key as keyof LivenessChecks] ? "text-green-400" : "text-gray-500"}>
                {label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Processing */}
      {state === "processing" && (
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-2 border-breath-cyan border-t-transparent rounded-full mx-auto" />
          <p className="mt-4 text-sm text-gray-400">Comparing face with document...</p>
        </div>
      )}

      {/* Success */}
      {state === "success" && (
        <div className="space-y-4 text-center">
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 text-sm text-green-400">
            Face matched with document. Score: {matchScore}%
          </div>
          <Button onClick={advanceStep}>Continue to Breath Check</Button>
        </div>
      )}

      {/* Initial / Error actions */}
      {(state === "setup" || state === "error") && (
        <div className="flex justify-center">
          <Button onClick={state === "error" ? retake : startCamera}>
            {state === "error" ? "Retry" : "Start Face Scan"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function calculateLivenessScore(checks: LivenessChecks): number {
  let score = 0;
  if (checks.blinkDetected) score += 25;
  if (checks.microMovement) score += 25;
  if (checks.depthVariation) score += 25;
  if (checks.consistentTexture) score += 25;
  return score;
}
