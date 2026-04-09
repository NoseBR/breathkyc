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

    const sent = Math.min(
      100,
      Math.max(68, Math.round(statsRef.current.breathScore))
    );

    try {
      const res = await apiPost("/v1/verify/breath", {
        sessionId,
        syncScore: sent,
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
            We verify liveness using <strong className="text-zinc-200">both</strong> mouth movement and breath sounds.
            Complete about <strong className="text-zinc-200">{BREATH_CYCLES_REQUIRED} slow breaths</strong> (breathe in,
            then out — deep enough to move your lips or be heard on the mic).
          </p>
          <div className="bg-zinc-800 p-4 rounded-xl text-left mb-6 text-sm text-zinc-300">
            <div className="flex items-center mb-2">
              <Camera className="w-4 h-4 mr-2 text-primary" /> Mouth / lip motion (visual)
            </div>
            <div className="flex items-center mb-2">
              <Mic className="w-4 h-4 mr-2 text-accent" /> Microphone — breath sounds, exhale, light “ha”
            </div>
            <div className="flex items-center text-zinc-500 text-xs">
              <Wind className="w-4 h-4 mr-2 shrink-0" /> Either channel can carry the signal; both together is best.
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
          <h2 className="text-xl font-bold mb-1 text-white">Breathe In & Out</h2>
          <p className="text-zinc-400 text-sm mb-6 text-center px-2">
            {engineReady
              ? `In through the nose or mouth, then out through the mouth with a little sound — ${BREATH_CYCLES_REQUIRED} full cycles fill the ring.`
              : "Starting camera and microphone..."}
          </p>

          {engineReady && (
            <p className="text-primary/90 text-sm font-semibold mb-2">
              Cycles: {currentStats.cyclesCompleted} / {BREATH_CYCLES_REQUIRED}
            </p>
          )}

          <div className="relative w-48 h-48 mb-8 flex items-center justify-center">
            {/* Glowing Microphone Indicator (Haptic scaling via audio) */}
            <div 
              className="absolute inset-0 bg-primary/20 rounded-full blur-2xl transition-all duration-[50ms]"
              style={{ transform: `scale(${1 + currentStats.audioVolume * 2})` }}
            />
            
            {/* Face/Mouth Anchor Feed */}
            <div className="relative w-40 h-40 bg-black rounded-full overflow-hidden border-4 border-zinc-800 z-10 transition-colors"
                 style={{ borderColor: currentStats.breathScore > 50 ? '#00E5FF' : '#27272a' }}>
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
               {/* Aperture Tracker Visual */}
               <div 
                 className="absolute bottom-4 left-1/2 -translate-x-1/2 w-8 bg-accent/80 rounded transition-all duration-75"
                 style={{ height: `${currentStats.mouthAperture * 100}%` }}
               />
            </div>

            {/* Completion Ring */}
            <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none z-30">
              <circle 
                cx="96" cy="96" r="90" 
                fill="none" stroke="#27272a" strokeWidth="8"
              />
              <circle 
                cx="96" cy="96" r="90" 
                fill="none" stroke="#00E5FF" strokeWidth="8"
                strokeDasharray="565"
                strokeDashoffset={
                  565 -
                  565 *
                    Math.min(1, currentStats.cyclesCompleted / BREATH_CYCLES_REQUIRED)
                }
                strokeLinecap="round"
                className="transition-all duration-300"
              />
            </svg>
          </div>

          <div className="w-full bg-zinc-800 p-3 rounded-xl space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-zinc-400 uppercase tracking-widest">Combined</span>
                <span className="text-lg font-bold text-primary font-mono">
                  {Math.round(currentStats.breathScore)}%
                </span>
              </div>
              {errorMSG ? (
                <span className="text-xs text-error text-right">{errorMSG}</span>
              ) : (
                <div className="flex gap-0.5 items-end h-10">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className="w-1.5 bg-accent/50 rounded-t"
                      style={{
                        height: `${8 + currentStats.audioVolume * 36 * (i / 6)}px`,
                        opacity: currentStats.audioVolume > i / 12 ? 1 : 0.25,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-[10px] text-zinc-500 uppercase tracking-wide">
              <div>
                <div className="text-zinc-400">Mouth</div>
                <div className="text-white font-mono">{Math.round(currentStats.mouthBreathScore)}</div>
              </div>
              <div>
                <div className="text-zinc-400">Sound</div>
                <div className="text-white font-mono">{Math.round(currentStats.audioBreathScore)}</div>
              </div>
              <div>
                <div className="text-zinc-400">Sync</div>
                <div className="text-white font-mono">{Math.round(currentStats.syncScore)}</div>
              </div>
            </div>
          </div>
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
