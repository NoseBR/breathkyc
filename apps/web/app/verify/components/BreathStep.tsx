"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, CheckCircle, Activity, Mic, Camera, Wind } from "lucide-react";
import { useBreathEngine, BREATH_CYCLES_REQUIRED } from "../../../hooks/useBreathEngine";
import { apiPost } from "../../../lib/api";
import { allowInsecureDevBypass } from "../../../lib/insecureContext";

interface BreathStepProps {
  sessionId: string;
  onSuccess: () => void;
  onFail: (reason: string) => void;
}

export default function BreathStep({ sessionId, onSuccess, onFail }: BreathStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { startEngine, stopEngine, engineReady, currentStats, mouthLandmarks } = useBreathEngine(videoRef);
  const statsRef = useRef(currentStats);
  const breathSubmittedRef = useRef(false);

  const [status, setStatus] = useState<"instructions" | "breathing" | "processing" | "result">("instructions");
  const [errorMSG, setErrorMSG] = useState<string | null>(null);

  useEffect(() => {
    statsRef.current = currentStats;
  }, [currentStats]);

  useEffect(() => {
    async function initAV() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false } // Raw audio preferred
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if (status === "breathing") {
          startEngine(stream);
        }

      } catch (e) {
        console.error("A/V error:", e);
        setErrorMSG("Camera or Microphone access denied.");
      }
    }
    
    if (status === "instructions" || status === "breathing") {
      initAV();
    }

    return () => {
      // Don't stop tracks immediately if we're just pivoting state
    };
  }, [status, startEngine]);

  useEffect(() => {
    if (status !== "breathing" || breathSubmittedRef.current) return;
    if (currentStats.cyclesCompleted >= BREATH_CYCLES_REQUIRED) {
      breathSubmittedRef.current = true;
      void submitBreathPayload();
    }
  }, [currentStats.cyclesCompleted, status]);

  const submitBreathPayload = async () => {
    setStatus("processing");
    stopEngine();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    const stats = statsRef.current;
    const sent = Math.min(100, Math.max(0, Math.round(stats.breathScore)));

    try {
      const res = await apiPost("/v1/verify/breath", {
        sessionId,
        syncScore: sent,
        mouthScore: Math.round(stats.mouthBreathScore),
        audioScore: Math.round(stats.audioBreathScore),
      });
      const data = await res.json();

      if (data.error || !data.passed) {
        setStatus("result");
        setErrorMSG(data.error || "Breath synchronization failed. Audio didn't match mouth physics.");
      } else {
        setStatus("result");
        setTimeout(() => onSuccess(), 3000);
      }
    } catch (e) {
      setStatus("result");
      setErrorMSG("Network transmission error.");
    }
  };

  const submitBreathDevBypass = async () => {
    setStatus("processing");
    try {
      const res = await apiPost("/v1/verify/breath", {
        sessionId,
        syncScore: 92,
      });
      const data = await res.json();

      if (data.error || !data.passed) {
        setStatus("result");
        setErrorMSG(data.error || "Breath verification failed.");
      } else {
        setStatus("result");
        setTimeout(() => onSuccess(), 3000);
      }
    } catch {
      setStatus("result");
      setErrorMSG("Network transmission error.");
    }
  };

  // Canvas Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (mouthLandmarks.length === 4) {
      ctx.fillStyle = "#B24BF3"; // Brand Accent Color
      mouthLandmarks.forEach((point: {x: number, y: number}) => {
         ctx.beginPath();
         ctx.arc(point.x * canvas.width, point.y * canvas.height, 2, 0, 2 * Math.PI);
         ctx.fill();
      });
    }
  }, [mouthLandmarks]);

  return (
    <div className="w-full max-w-md mx-auto p-4 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl flex flex-col items-center">
      
      {status === "instructions" && (
        <div className="text-center py-6">
          <Activity className="w-16 h-16 text-primary mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2 text-white">Breath Validation</h2>
          <p className="text-zinc-400 text-sm mb-6 px-4">
            Follow a guided breathing exercise: you&apos;ll be prompted to
            <strong className="text-zinc-200"> breathe IN</strong> and
            <strong className="text-zinc-200"> breathe OUT</strong> for {BREATH_CYCLES_REQUIRED} complete cycles.
            Your breathing must be <strong className="text-zinc-200">audible to the microphone</strong>.
          </p>
          <div className="bg-zinc-800 p-4 rounded-xl text-left mb-6 text-sm text-zinc-300">
            <div className="flex items-center mb-2">
              <Camera className="w-4 h-4 mr-2 text-primary" /> Face must be visible in frame
            </div>
            <div className="flex items-center mb-2">
              <Mic className="w-4 h-4 mr-2 text-accent" /> Microphone must hear inhale and exhale
            </div>
            <div className="flex items-center text-yellow-500 text-xs font-medium">
              <Wind className="w-4 h-4 mr-2 shrink-0" /> Silent breathing will not be counted.
            </div>
          </div>
          <button
            onClick={() => {
              breathSubmittedRef.current = false;
              setStatus("breathing");
            }}
            className="w-full h-12 flex items-center justify-center bg-primary text-black font-bold rounded-xl hover:bg-primary/90 transition shadow-[0_0_20px_rgba(0,229,255,0.4)]"
          >
            Start Breath Protocol
          </button>

          {allowInsecureDevBypass() && (
            <button
              type="button"
              onClick={() => void submitBreathDevBypass()}
              className="mt-4 w-full h-10 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 rounded-xl px-2"
            >
              Skip camera &amp; microphone (dev — use if browser blocks AV on http://LAN)
            </button>
          )}
          
          <video ref={videoRef} autoPlay playsInline muted className="hidden" />
        </div>
      )}

      {status === "breathing" && (
        <div className="w-full flex flex-col items-center py-4">
          {/* Phase instructions */}
          {!engineReady ? (
            <h2 className="text-xl font-bold mb-4 text-white">Starting camera and microphone...</h2>
          ) : currentStats.breathPhase === "idle" ? (
            <div className="text-center mb-4">
              <h2 className="text-2xl font-bold text-yellow-400 animate-pulse">Get Ready...</h2>
              <p className="text-zinc-500 text-sm mt-1">Next breath coming up</p>
            </div>
          ) : currentStats.breathPhase === "inhale" ? (
            <div className="text-center mb-4">
              <h2 className="text-3xl font-black text-cyan-400">BREATHE IN</h2>
              <p className="text-cyan-400/50 text-sm mt-1">Inhale deeply through your nose or mouth</p>
            </div>
          ) : (
            <div className="text-center mb-4">
              <h2 className="text-3xl font-black text-green-400">BREATHE OUT</h2>
              <p className="text-green-400/50 text-sm mt-1">Exhale slowly — let the mic hear you</p>
            </div>
          )}

          {/* Phase progress bar */}
          {engineReady && currentStats.breathPhase !== "idle" && (
            <div className="w-full max-w-[200px] h-1.5 bg-zinc-800 rounded-full mb-6 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-100 ${
                  currentStats.breathPhase === "inhale" ? "bg-cyan-400" : "bg-green-400"
                }`}
                style={{ width: `${currentStats.phaseProgress * 100}%` }}
              />
            </div>
          )}

          {/* Animated breathing circle with video */}
          <div className="relative w-48 h-48 mb-6 flex items-center justify-center">
            {/* Breathing glow — expands on inhale, contracts on exhale */}
            <div
              className={`absolute inset-0 rounded-full blur-2xl transition-all duration-200 ${
                currentStats.breathPhase === "inhale"
                  ? "bg-cyan-400/20"
                  : currentStats.breathPhase === "exhale"
                  ? "bg-green-400/20"
                  : "bg-zinc-600/10"
              }`}
              style={{
                transform: `scale(${
                  currentStats.breathPhase === "inhale"
                    ? 1 + currentStats.phaseProgress * 0.5
                    : currentStats.breathPhase === "exhale"
                    ? 1.5 - currentStats.phaseProgress * 0.5
                    : 1
                })`,
              }}
            />

            {/* Video circle */}
            <div
              className="relative w-40 h-40 bg-black rounded-full overflow-hidden border-4 z-10 transition-all duration-200"
              style={{
                borderColor:
                  currentStats.breathPhase === "inhale"
                    ? "#22d3ee"
                    : currentStats.breathPhase === "exhale"
                    ? "#4ade80"
                    : "#27272a",
                transform: `scale(${
                  currentStats.breathPhase === "inhale"
                    ? 1 + currentStats.phaseProgress * 0.08
                    : currentStats.breathPhase === "exhale"
                    ? 1.08 - currentStats.phaseProgress * 0.08
                    : 1
                })`,
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                width={160}
                height={160}
                className="absolute inset-0 z-20 scale-x-[-1] opacity-80"
              />
            </div>

            {/* Completion Ring */}
            <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none z-30">
              <circle cx="96" cy="96" r="90" fill="none" stroke="#27272a" strokeWidth="8" />
              <circle
                cx="96"
                cy="96"
                r="90"
                fill="none"
                stroke={
                  currentStats.breathPhase === "inhale"
                    ? "#22d3ee"
                    : currentStats.breathPhase === "exhale"
                    ? "#4ade80"
                    : "#00E5FF"
                }
                strokeWidth="8"
                strokeDasharray="565"
                strokeDashoffset={
                  565 - 565 * Math.min(1, currentStats.cyclesCompleted / BREATH_CYCLES_REQUIRED)
                }
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
          </div>

          {/* Sound detection indicator + live RMS meter */}
          {engineReady && (
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    currentStats.breathingDetected
                      ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]"
                      : "bg-zinc-600"
                  }`}
                />
                <span
                  className={`text-sm ${
                    currentStats.breathingDetected ? "text-green-400" : "text-zinc-500"
                  }`}
                >
                  {currentStats.breathingDetected ? "Breath sound detected" : "Listening for breath..."}
                </span>
              </div>
              {/* Live audio level bar */}
              <div className="w-full max-w-[200px] flex items-center gap-2">
                <span className="text-[10px] text-zinc-600 w-6">MIC</span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${
                      currentStats.breathingDetected ? "bg-green-400" : "bg-zinc-600"
                    }`}
                    style={{ width: `${Math.min(100, (currentStats.audioRms || 0) * 1500)}%` }}
                  />
                </div>
                <span className="text-[10px] text-zinc-600 w-12 text-right font-mono">
                  {((currentStats.audioRms || 0) * 1000).toFixed(1)}
                </span>
              </div>
            </div>
          )}

          {/* Cycle indicators */}
          {engineReady && (
            <div className="flex gap-3 items-center justify-center">
              {Array.from({ length: BREATH_CYCLES_REQUIRED }, (_, i) => (
                <div
                  key={i}
                  className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                    i < currentStats.cyclesCompleted
                      ? "bg-cyan-400 border-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                      : "bg-transparent border-zinc-600"
                  }`}
                />
              ))}
              <span className="text-zinc-400 text-sm ml-2">
                {currentStats.cyclesCompleted} / {BREATH_CYCLES_REQUIRED} cycles
              </span>
            </div>
          )}
        </div>
      )}

      {status === "processing" && (
        <div className="w-full h-[400px] flex flex-col items-center justify-center">
          <Activity className="w-16 h-16 text-primary animate-pulse mb-6" />
          <h3 className="text-white font-medium text-xl">Verifying Liveness Matrix</h3>
          <p className="text-zinc-500 text-sm mt-2 text-center max-w-[250px]">
            Finalizing synchronization proofs between your audio waveform and facial mesh outputs.
          </p>
        </div>
      )}

      {status === "result" && (
        <div className="w-full h-[400px] flex flex-col items-center justify-center text-center px-4">
          {errorMSG ? (
            <>
              <ShieldAlert className="w-16 h-16 text-error mb-4" />
              <h3 className="text-white font-bold text-lg mb-2">Breath Verification Failed</h3>
              <p className="text-error text-sm">{errorMSG}</p>
              <button 
                onClick={() => {
                  setStatus("instructions");
                  setErrorMSG(null);
                  breathSubmittedRef.current = false;
                }}
                className="mt-6 border border-zinc-700 hover:bg-zinc-800 text-white rounded-lg px-6 py-2 transition"
              >
                Restart Protocol
              </button>
            </>
          ) : (
            <>
               <CheckCircle className="w-20 h-20 text-primary mb-6 animate-[bounce_1s_ease-in-out_infinite]" />
               <h3 className="text-white font-black text-2xl mb-2 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Identity Verified</h3>
               <p className="text-zinc-400 text-sm mb-6">
                 Your biological signature has been securely validated and locked to this session.
               </p>
            </>
          )}
        </div>
      )}

    </div>
  );
}
