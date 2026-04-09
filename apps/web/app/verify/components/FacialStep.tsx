"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, ShieldAlert, Upload } from "lucide-react";
import { useFaceMesh } from "../../../hooks/useFaceMesh";
import { apiPostForm } from "../../../lib/api";
import { allowInsecureDevBypass, isInsecureContext } from "../../../lib/insecureContext";

function formatFaceFailureMessage(data: {
  error?: string;
  passed?: boolean;
  livenessPassed?: boolean;
  matchPassed?: boolean;
  livenessScore?: number;
  matchScore?: number;
  livenessMin?: number;
  matchMin?: number;
}): string {
  if (typeof data.error === "string" && data.error) return data.error;
  const parts: string[] = [];
  if (data.livenessPassed === false) {
    const min = data.livenessMin ?? 60;
    const s = Math.round(Number(data.livenessScore) || 0);
    parts.push(
      `Liveness ${s}/${min} — blink, move your head slightly, then hold steady for the countdown.`
    );
  }
  if (data.matchPassed === false) {
    const min = data.matchMin ?? 48;
    const m = Math.round(Number(data.matchScore) || 0);
    parts.push(
      `Face match ${m}% (need ${min}%). Use bright, even light; fill the oval with your face; retake the document so the portrait is sharp.`
    );
  }
  if (parts.length) return parts.join(" ");
  return "Biometric validation failed. Are you the same person as the document?";
}

interface FacialStepProps {
  sessionId: string;
  onSuccess: () => void;
  onFail: (reason: string) => void;
}

/** Must match API `LIVENESS_MIN` in apps/api/src/routes/face.ts */
const LIVENESS_THRESHOLD = 60;

export default function FacialStep({ sessionId, onSuccess, onFail }: FacialStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);

  const { isLoaded, faceDetected, liveness, landmarks } = useFaceMesh(videoRef);
  
  const [mediaMode, setMediaMode] = useState<"camera" | "upload">("camera");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [status, setStatus] = useState<"scanning" | "uploading" | "result">("scanning");
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openFrontCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
      setErrorMSG(null);
    } catch (e) {
      console.error("Camera error:", e);
      if (isInsecureContext()) {
        setErrorMSG(
          "Camera blocked: http:// + Wi‑Fi IP is not a secure context on most phones. Use “Upload selfie” below or HTTPS."
        );
      } else {
        setErrorMSG("Front camera access denied. Allow camera for this site in browser settings.");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isInsecureContext() && allowInsecureDevBypass()) {
      setMediaMode("upload");
      return;
    }

    void openFrontCamera();

    return () => {
      stopCamera();
    };
  }, [openFrontCamera, stopCamera]);

  // Sync canvas dimensions with video
  useEffect(() => {
    if (videoRef.current && canvasRef.current) {
      canvasRef.current.width = videoRef.current.clientWidth;
      canvasRef.current.height = videoRef.current.clientHeight;
    }
  }, [faceDetected, landmarks]);

  // Draw face mesh
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (landmarks && landmarks.length > 0) {
      ctx.fillStyle = "#00E5FF";
      (landmarks as {x: number, y: number}[]).forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 1, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  }, [landmarks]);

  // Handle Logic
  useEffect(() => {
    if (status !== "scanning") return;

    if (faceDetected && liveness.score >= LIVENESS_THRESHOLD && countdown === null) {
      // start countdown
      setCountdown(3);
    } else if (!faceDetected || liveness.score < LIVENESS_THRESHOLD) {
      setCountdown(null);
    }
  }, [faceDetected, liveness.score, status, countdown]);

  useEffect(() => {
    if (status !== "scanning") return;
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      snapAndUpload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, status]);

  const snapAndUpload = async () => {
    setStatus("uploading");
    if (!videoRef.current) return;
    
    const snapCanvas = document.createElement("canvas");
    snapCanvas.width = videoRef.current.videoWidth;
    snapCanvas.height = videoRef.current.videoHeight;
    const ctx = snapCanvas.getContext("2d");
    if (!ctx) return;
    
    ctx.drawImage(videoRef.current, 0, 0, snapCanvas.width, snapCanvas.height);
    
    snapCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "face.jpg", { type: "image/jpeg" });
      
      const formData = new FormData();
      formData.append("sessionId", sessionId);
      formData.append("livenessScore", liveness.score.toString());
      formData.append("face", file);

      try {
        const res = await apiPostForm("/v1/verify/face", formData);
        const data = await res.json();

        if (data.error || !data.passed) {
          setStatus("result");
          setErrorMSG(formatFaceFailureMessage(data));
        } else {
          setStatus("result");
          setMatchScore(data.matchScore);
          setTimeout(() => onSuccess(), 2500);
        }
      } catch (err) {
        setStatus("result");
        setErrorMSG("Network transmission error.");
        console.error(err);
      }
    }, "image/jpeg", 0.9);
  };

  const uploadSelfieFromFile = async (file: File) => {
    setStatus("uploading");
    setErrorMSG(null);
    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("livenessScore", "88");
    formData.append("face", file);

    try {
      const res = await apiPostForm("/v1/verify/face", formData);
      const data = await res.json();

      if (data.error || !data.passed) {
        setStatus("result");
        setErrorMSG(formatFaceFailureMessage(data));
      } else {
        setStatus("result");
        setMatchScore(data.matchScore);
        setTimeout(() => onSuccess(), 2500);
      }
    } catch (err) {
      setStatus("result");
      setErrorMSG("Network transmission error.");
      console.error(err);
    }
  };

  const onSelfieFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadSelfieFromFile(file);
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl flex flex-col items-center">
      
      {status === "scanning" && mediaMode === "upload" && allowInsecureDevBypass() && (
        <>
          <h2 className="text-xl font-bold mb-1 text-white">Face Biometrics</h2>
          <p className="text-zinc-400 text-sm mb-4 text-center px-2">
            Live camera is often blocked on <strong className="text-zinc-300">http://</strong> over Wi‑Fi. Upload a
            clear front-facing selfie (dev bypass — not for production).
          </p>
          <input
            ref={selfieInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onSelfieFileChange}
          />
          <button
            type="button"
            onClick={() => selfieInputRef.current?.click()}
            className="w-full h-12 flex items-center justify-center gap-2 bg-primary text-black font-semibold rounded-xl hover:bg-primary/90 transition mb-3"
          >
            <Upload className="w-5 h-5" />
            Upload selfie photo
          </button>
          <button
            type="button"
            onClick={() => {
              setMediaMode("camera");
              void openFrontCamera();
            }}
            className="w-full h-10 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-xl"
          >
            Try live camera anyway
          </button>
          <video ref={videoRef} autoPlay playsInline muted className="sr-only" aria-hidden />
        </>
      )}

      {status === "scanning" && mediaMode === "camera" && (
        <>
          <h2 className="text-xl font-bold mb-1 text-white">Face Biometrics</h2>
          <p className="text-zinc-400 text-sm mb-4 text-center">
            {isLoaded ? "Move your head slightly and blink." : "Initializing MediaPipe Engine..."}
          </p>

          {errorMSG && (
            <div className="w-full text-error text-xs text-center mb-3 px-2">{errorMSG}</div>
          )}

          {allowInsecureDevBypass() && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setMediaMode("upload");
                setErrorMSG(null);
              }}
              className="w-full mb-3 h-9 text-xs text-zinc-500 hover:text-zinc-300 underline"
            >
              Use gallery upload instead (dev)
            </button>
          )}

          <div className="relative w-full aspect-[3/4] max-h-96 bg-black rounded-full overflow-hidden mb-4 border-[4px] border-zinc-800">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover scale-x-[-1]"
            />
            {/* Mesh Overlay */}
            <canvas 
              ref={canvasRef} 
              className="absolute inset-0 z-10 scale-x-[-1] opacity-70"
            />
            
            {/* Countdown Overlay */}
            {countdown !== null && countdown > 0 && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
                <span className="text-6xl font-black text-primary drop-shadow-[0_0_20px_rgba(0,229,255,0.8)]">
                  {countdown}
                </span>
              </div>
            )}
          </div>

          <div className="w-full space-y-2 px-2 pb-2">
            <div className="flex justify-between items-center bg-zinc-800 px-3 py-2 rounded-lg">
              <span className="text-xs text-white">Face Engine Loaded</span>
              <CheckCircle className={`w-4 h-4 ${isLoaded ? 'text-primary' : 'text-zinc-600'}`} />
            </div>
            <div className="flex justify-between items-center bg-zinc-800 px-3 py-2 rounded-lg">
              <span className="text-xs text-white">Face Centered</span>
              <CheckCircle className={`w-4 h-4 ${faceDetected ? 'text-primary' : 'text-zinc-600'}`} />
            </div>
            <div className="flex justify-between items-center bg-zinc-800 px-3 py-2 rounded-lg">
              <span className="text-xs text-white">Liveness ({LIVENESS_THRESHOLD}+)</span>
              <span
                className={`text-xs font-bold ${liveness.score >= LIVENESS_THRESHOLD ? "text-primary" : "text-error"}`}
              >
                {liveness.score}/100
              </span>
            </div>
          </div>
        </>
      )}

      {status === "uploading" && (
        <div className="w-full h-[400px] flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-t-2 border-primary border-solid rounded-full animate-spin mb-4" />
          <h3 className="text-white font-medium">Analyzing Identity Matrix</h3>
          <p className="text-zinc-500 text-sm mt-2">Running Document comparison matching...</p>
        </div>
      )}

      {status === "result" && (
        <div className="w-full h-[400px] flex flex-col items-center justify-center text-center px-4">
          {errorMSG ? (
            <>
              <ShieldAlert className="w-16 h-16 text-error mb-4" />
              <h3 className="text-white font-bold text-lg mb-2">Validation Failed</h3>
              <p className="text-error text-sm">{errorMSG}</p>
              <button 
                onClick={() => {
                  setStatus("scanning");
                  setErrorMSG(null);
                  setCountdown(null);
                  if (typeof window !== "undefined" && isInsecureContext() && allowInsecureDevBypass()) {
                    setMediaMode("upload");
                    stopCamera();
                  }
                }}
                className="mt-6 border border-zinc-700 hover:bg-zinc-800 text-white rounded-lg px-6 py-2 transition"
              >
                Retry Scan
              </button>
            </>
          ) : (
            <>
               <CheckCircle className="w-16 h-16 text-primary mb-4" />
               <h3 className="text-white font-bold text-lg mb-2">Match Successful</h3>
               <p className="text-zinc-400 text-sm">Automated match correlation: <strong className="text-primary">{matchScore}%</strong> similarity detected.</p>
               <div className="mt-8 text-xs text-zinc-500 animate-pulse">Proceeding to Breath Engine...</div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
