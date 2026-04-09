"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { apiPostForm, apiPost, getApiBase } from "../../../lib/api";

interface DocumentStepProps {
  sessionId: string;
  onSuccess: () => void;
  onFail: (reason: string) => void;
}

type ExtractedData = {
  name: string;
  cpf: string;
  dateOfBirth: string;
  documentNumber: string;
};

export default function DocumentStep({
  sessionId,
  onSuccess,
  onFail,
}: DocumentStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [docType, setDocType] = useState<string>("CNH"); // Default CNH
  const [status, setStatus] = useState<"capture" | "uploading" | "review">("capture");
  
  const [extractedData, setExtractedData] = useState<ExtractedData>({
    name: "", cpf: "", dateOfBirth: "", documentNumber: ""
  });
  const [errorMSG, setErrorMSG] = useState<string | null>(null);
  const [ocrMeta, setOcrMeta] = useState<{
    engine: string;
    confidence: number;
    autoRotateDegrees?: number;
  } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedObjectUrlRef = useRef<string | null>(null);

  const revokePreviewUrl = () => {
    if (capturedObjectUrlRef.current) {
      URL.revokeObjectURL(capturedObjectUrlRef.current);
      capturedObjectUrlRef.current = null;
    }
  };

  useEffect(() => {
    // Attempt to open environment (rear) camera
    async function initCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1920, max: 4096 },
            height: { ideal: 1080, max: 2160 },
          },
          audio: false,
        });
        streamRef.current = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        console.warn("Camera failed to load. Will fallback to file upload.", e);
      }
    }
    initCamera();

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      revokePreviewUrl();
    };
  }, []);

  // Video unmounts during "uploading"; remounting does not restore srcObject by itself.
  useEffect(() => {
    if (status !== "capture" || !stream) return;
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play().catch(() => {});
  }, [status, stream]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      setErrorMSG("Camera is still starting — wait a second and try again.");
      return;
    }
    
    // Draw current video frame to canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to blob and trigger upload
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
        revokePreviewUrl();
        const imageUrl = URL.createObjectURL(blob);
        capturedObjectUrlRef.current = imageUrl;
        setCapturedImage(imageUrl);
        uploadDocument(file);
      }
    }, "image/jpeg", 0.9);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      revokePreviewUrl();
      const imageUrl = URL.createObjectURL(file);
      capturedObjectUrlRef.current = imageUrl;
      setCapturedImage(imageUrl);
      uploadDocument(file);
    }
  };

  const uploadDocument = async (file: File) => {
    setStatus("uploading");
    setErrorMSG(null);

    const formData = new FormData();
    formData.append("sessionId", sessionId);
    formData.append("documentType", docType);
    formData.append("document", file);

    try {
      const res = await apiPostForm("/v1/verify/document", formData);
      const raw = await res.text();
      let data: {
        error?: string;
        extractedData?: ExtractedData;
        ocrConfidence?: number;
        ocrEngine?: string;
        ocrAutoRotateDegrees?: number;
      } = {};

      if (raw.trim()) {
        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          setStatus("capture");
          revokePreviewUrl();
          setCapturedImage(null);
          setErrorMSG(
            res.ok
              ? "Server returned a non-JSON response."
              : `Server error ${res.status}. ${raw.slice(0, 160).replace(/\s+/g, " ")}`
          );
          return;
        }
      }

      if (!res.ok) {
        setStatus("capture");
        revokePreviewUrl();
        setCapturedImage(null);
        const msg =
          typeof data.error === "string"
            ? data.error
            : `Request failed (HTTP ${res.status}). Check the API terminal for errors.`;
        setErrorMSG(msg);
        return;
      }

      if (!data.extractedData) {
        setStatus("capture");
        revokePreviewUrl();
        setCapturedImage(null);
        setErrorMSG("Invalid document response from server.");
        return;
      }

      setExtractedData(data.extractedData);
      if (typeof data.ocrConfidence === "number" && data.ocrEngine) {
        setOcrMeta({
          engine: String(data.ocrEngine),
          confidence: data.ocrConfidence,
          autoRotateDegrees:
            typeof data.ocrAutoRotateDegrees === "number" ? data.ocrAutoRotateDegrees : undefined,
        });
      } else {
        setOcrMeta(null);
      }
      setStatus("review");
    } catch (e) {
      setStatus("capture");
      revokePreviewUrl();
      setCapturedImage(null);
      const hint = getApiBase();
      const err = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|networkerror|load failed|aborted/i.test(err)) {
        setErrorMSG(
          `Cannot reach the API at ${hint}. Start it with pnpm dev (port 3001) and refresh.`
        );
      } else {
        setErrorMSG(`Upload failed: ${err}`);
      }
    }
  };

  const confirmData = async () => {
    setStatus("uploading");
    setErrorMSG(null);
    try {
      const res = await apiPost("/v1/verify/document/confirm", {
        sessionId,
        ...extractedData
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("review");
        setErrorMSG(
          typeof data.error === "string"
            ? data.error
            : Array.isArray(data.error)
              ? "Invalid form data."
              : "Could not confirm document."
        );
        return;
      }
      onSuccess();
    } catch (e) {
      setStatus("review");
      setErrorMSG("Network error. Could not confirm data.");
    }
  };

  const handleChange = (field: keyof ExtractedData, value: string) => {
    setExtractedData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="w-full max-w-full sm:max-w-xl md:max-w-2xl mx-auto p-3 sm:p-4 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl flex flex-col items-center">
      
      {/* CAPTURE STATE */}
      {status === "capture" && (
        <>
          <h2 className="text-xl font-bold mb-1 text-white">Identity Document</h2>
          <p className="text-zinc-400 text-sm mb-3 text-center px-1">
            Fit the whole CNH in the frame — hold steady, good light, text readable. Step back if needed.
          </p>

          <div className="flex gap-2 w-full mb-4 bg-zinc-800 p-1 rounded-lg">
            {['CNH', 'RG'].map(type => (
              <button
                key={type}
                onClick={() => setDocType(type)}
                className={`flex-1 py-1 text-sm font-semibold rounded-md transition-colors ${
                  docType === type ? "bg-primary text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="relative w-full min-h-[min(58dvh,520px)] max-h-[68dvh] sm:min-h-[420px] sm:max-h-[560px] bg-black rounded-xl overflow-hidden mb-4 border-2 border-zinc-800">
            {stream ? (
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* Overlay Guide Mask — ID-1 / CNH ratio (~85.6×54mm), as large as the viewport allows */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-2 sm:p-3 overflow-hidden">
                  <div
                    className="rounded-xl outline outline-[3px] outline-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] w-[min(100%,calc(100vw-2.5rem))] max-w-[min(640px,92vw)] aspect-[85/54]"
                  >
                    <div className="absolute top-0 left-0 w-9 h-9 sm:w-10 sm:h-10 border-t-[4px] border-l-[4px] border-[#00E5FF] rounded-tl-xl" />
                    <div className="absolute top-0 right-0 w-9 h-9 sm:w-10 sm:h-10 border-t-[4px] border-r-[4px] border-[#00E5FF] rounded-tr-xl" />
                    <div className="absolute bottom-0 left-0 w-9 h-9 sm:w-10 sm:h-10 border-b-[4px] border-l-[4px] border-[#00E5FF] rounded-bl-xl" />
                    <div className="absolute bottom-0 right-0 w-9 h-9 sm:w-10 sm:h-10 border-b-[4px] border-r-[4px] border-[#00E5FF] rounded-br-xl" />
                  </div>
                </div>
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500">
                <Camera className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-xs px-8 text-center">
                  Camera unavailable on this URL? Use <strong className="text-zinc-400">Choose photo</strong> below
                  (http:// + Wi‑Fi IP often blocks camera).
                </span>
              </div>
            )}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {errorMSG && (
            <div className="w-full bg-error/10 text-error text-xs p-3 rounded-lg border border-error/20 mb-4 text-center">
              {errorMSG}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleFileUpload}
          />
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <button
              type="button"
              onClick={handleCapture}
              disabled={!stream}
              className="flex-1 h-12 flex items-center justify-center bg-primary text-black font-semibold rounded-xl hover:bg-primary/90 transition disabled:opacity-50"
            >
              <Camera className="w-5 h-5 mr-2" /> Capture
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 h-12 flex items-center justify-center bg-zinc-800 text-white font-semibold rounded-xl hover:bg-zinc-700 transition border border-zinc-600"
            >
              Choose photo
            </button>
          </div>
        </>
      )}

      {/* UPLOADING STATE */}
      {status === "uploading" && (
        <div className="w-full h-64 flex flex-col items-center justify-center">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <h3 className="text-white font-medium">Scanning Document...</h3>
          <p className="text-zinc-500 text-sm mt-2">OCR and document portrait encoding for face match</p>
        </div>
      )}

      {/* REVIEW STATE */}
      {status === "review" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full">
          <div className="flex items-center justify-center mb-6 mt-2">
            <CheckCircle className="w-8 h-8 text-accent mr-3" />
            <h2 className="text-xl font-bold text-white">Review Data</h2>
          </div>
          {ocrMeta && (
            <div className="text-xs text-zinc-500 text-center mb-4 -mt-2 space-y-1">
              <p>
                OCR ({ocrMeta.engine}) · ~{ocrMeta.confidence}% confidence — correct any mistakes before
                confirming.
              </p>
              {ocrMeta.autoRotateDegrees ? (
                <p className="text-zinc-600">
                  Sideways photo detected: text was read after a {ocrMeta.autoRotateDegrees}° rotation
                  (preview unchanged). Face match uses the corrected orientation.
                </p>
              ) : null}
            </div>
          )}

          <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden mb-6 border border-zinc-800">
             {capturedImage && (
              // eslint-disable-next-line @next/next/no-img-element
               <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
             )}
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="text-xs text-zinc-400 font-medium px-1 uppercase tracking-wider">Full Name</label>
              <input 
                type="text" 
                value={extractedData.name} 
                onChange={(e) => handleChange("name", e.target.value)}
                className="w-full bg-zinc-800 border-none text-white rounded-xl p-3 mt-1 focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-zinc-400 font-medium px-1 uppercase tracking-wider">CPF Number</label>
                <input 
                  type="text" 
                  value={extractedData.cpf} 
                  onChange={(e) => handleChange("cpf", e.target.value)}
                  className="w-full bg-zinc-800 border-none text-white rounded-xl p-3 mt-1 focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-zinc-400 font-medium px-1 uppercase tracking-wider">Doc Number</label>
                <input 
                  type="text" 
                  value={extractedData.documentNumber} 
                  onChange={(e) => handleChange("documentNumber", e.target.value)}
                  className="w-full bg-zinc-800 border-none text-white rounded-xl p-3 mt-1 focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-medium px-1 uppercase tracking-wider">Date of Birth</label>
              <input 
                type="text" 
                value={extractedData.dateOfBirth} 
                onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                className="w-full bg-zinc-800 border-none text-white rounded-xl p-3 mt-1 focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          {errorMSG && (
            <div className="w-full bg-error/10 text-error text-xs p-3 rounded-lg border border-error/20 mb-4 text-center">
              {errorMSG}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => {
                revokePreviewUrl();
                setStatus("capture");
                setCapturedImage(null);
                setErrorMSG(null);
                setOcrMeta(null);
              }}
              className="flex-1 h-12 bg-zinc-800 text-white font-semibold rounded-xl hover:bg-zinc-700 transition"
            >
              Retake Image
            </button>
            <button
              onClick={confirmData}
              className="flex-1 h-12 bg-accent text-white font-bold rounded-xl hover:bg-accent/90 transition shadow-[0_0_20px_rgba(178,75,243,0.3)]"
            >
              Confirm
            </button>
          </div>
        </motion.div>
      )}

    </div>
  );
}
