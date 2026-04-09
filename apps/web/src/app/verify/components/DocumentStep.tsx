"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useVerificationStore } from "@/hooks/useVerificationStore";
import { api } from "@/lib/api";

type DocState = "select" | "capture" | "preview" | "processing" | "confirm" | "error";
type DocumentType = "cnh" | "rg" | "passport";

interface ExtractedFields {
  name: string;
  cpf: string;
  dateOfBirth: string;
  documentNumber: string;
  ocrConfidence: number;
}

export function DocumentStep() {
  const [state, setState] = useState<DocState>("select");
  const [docType, setDocType] = useState<DocumentType>("cnh");
  const [capturedImage, setCapturedImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ExtractedFields | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { sessionId, setDocumentResult, advanceStep, failStep } = useVerificationStore();

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setState("capture");
    } catch {
      setError("Camera access denied. You can also upload a photo of your document.");
      setState("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], "document.jpg", { type: "image/jpeg" });
        setCapturedImage(file);
        setPreviewUrl(URL.createObjectURL(blob));
        stopCamera();
        setState("preview");
      },
      "image/jpeg",
      0.92
    );
  }, [stopCamera]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setCapturedImage(file);
      setPreviewUrl(URL.createObjectURL(file));
      stopCamera();
      setState("preview");
    },
    [stopCamera]
  );

  const submitDocument = useCallback(async () => {
    if (!capturedImage || !sessionId) return;
    setState("processing");
    setError(null);

    const res = await api.uploadDocument(sessionId, docType, capturedImage);

    if (!res.success || !res.data) {
      setError(res.error ?? "Document processing failed.");
      setState("error");
      failStep();
      return;
    }

    setFields(res.data as ExtractedFields);
    setState("confirm");
  }, [capturedImage, sessionId, docType, failStep]);

  const confirmFields = useCallback(async () => {
    if (!fields || !sessionId) return;
    setState("processing");

    const res = await api.confirmDocument(sessionId, {
      name: fields.name,
      cpf: fields.cpf,
      dateOfBirth: fields.dateOfBirth,
      documentNumber: fields.documentNumber,
    });

    if (!res.success) {
      setError(res.error ?? "Confirmation failed.");
      setState("error");
      return;
    }

    setDocumentResult({
      documentType: docType,
      ...fields,
    });
    advanceStep();
  }, [fields, sessionId, docType, setDocumentResult, advanceStep]);

  const retake = useCallback(() => {
    setCapturedImage(null);
    setPreviewUrl(null);
    setFields(null);
    setError(null);
    setState("select");
  }, []);

  return (
    <Card glow className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 mx-auto rounded-full bg-breath-cyan/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-breath-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Document Verification</h2>
        <p className="text-sm text-gray-400">
          Take a photo of your identity document or upload an existing one.
        </p>
      </div>

      {error && (
        <div className="bg-breath-rose/10 border border-breath-rose/30 rounded-xl p-4 text-sm text-breath-rose">
          {error}
        </div>
      )}

      {/* Document Type Selector */}
      {(state === "select" || state === "error") && (
        <div className="space-y-4">
          <div className="flex gap-2 justify-center">
            {(["cnh", "rg", "passport"] as const).map((type) => (
              <button
                key={type}
                onClick={() => setDocType(type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  docType === type
                    ? "bg-breath-cyan/20 text-breath-cyan border border-breath-cyan/40"
                    : "bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600"
                }`}
              >
                {type.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={startCamera}>Open Camera</Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Upload Photo
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Camera Feed */}
      {state === "capture" && (
        <div className="space-y-4">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            <div className="absolute inset-8 border-2 border-breath-cyan/40 rounded-lg pointer-events-none" />
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={capturePhoto}>Capture</Button>
            <Button variant="secondary" onClick={() => { stopCamera(); setState("select"); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Preview */}
      {state === "preview" && previewUrl && (
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden bg-black">
            <img src={previewUrl} alt="Captured document" className="w-full" />
          </div>
          <div className="flex gap-3 justify-center">
            <Button onClick={submitDocument}>Process Document</Button>
            <Button variant="secondary" onClick={retake}>Retake</Button>
          </div>
        </div>
      )}

      {/* Processing */}
      {state === "processing" && (
        <div className="text-center py-8">
          <div className="animate-spin w-8 h-8 border-2 border-breath-cyan border-t-transparent rounded-full mx-auto" />
          <p className="mt-4 text-sm text-gray-400">Processing document...</p>
        </div>
      )}

      {/* Confirm Fields */}
      {state === "confirm" && fields && (
        <div className="space-y-4">
          <div className="space-y-3">
            {[
              { label: "Full Name", value: fields.name },
              { label: "CPF", value: fields.cpf },
              { label: "Date of Birth", value: fields.dateOfBirth },
              { label: "Document Number", value: fields.documentNumber },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center py-2 border-b border-gray-800">
                <span className="text-sm text-gray-400">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 text-center">
            OCR Confidence: {Math.round(fields.ocrConfidence * 100)}%
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={confirmFields}>Confirm & Continue</Button>
            <Button variant="secondary" onClick={retake}>Retake</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
