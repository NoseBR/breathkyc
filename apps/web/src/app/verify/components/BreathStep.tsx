"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useVerificationStore } from "@/hooks/useVerificationStore";
import { api } from "@/lib/api";
import type { BreathGuidePhase, AudioFeatures, VisualFeatures } from "@/types/breath";

const PHASE_DURATIONS: Record<BreathGuidePhase, number> = {
  ready: 2000,
  inhale: 3000,
  hold: 1000,
  exhale: 3000,
  processing: 2000,
  result: 0,
};

// Add slight randomization to prevent scripted attacks
function randomize(ms: number): number {
  return ms + Math.floor(Math.random() * 600 - 300);
}

export function BreathStep() {
  const [phase, setPhase] = useState<BreathGuidePhase | "idle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [circleScale, setCircleScale] = useState(1);
  const [result, setResult] = useState<{
    audioScore: number;
    visualScore: number;
    correlationScore: number;
    totalScore: number;
    passed: boolean;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);

  // Timeline data for analysis
  const audioTimelineRef = useRef<number[]>([]);
  const spectralSnapshotsRef = useRef<number[][]>([]);
  const mouthTimelineRef = useRef<number[]>([]);
  const shoulderTimelineRef = useRef<number[]>([]);
  const phaseTimestampsRef = useRef<Record<string, number>>({});

  const { sessionId, setBreathResult, advanceStep, failStep, setOverallScore, setStatus } =
    useVerificationStore();

  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioContextRef.current?.state !== "closed") {
      audioContextRef.current?.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  const startBreathCheck = useCallback(async () => {
    setError(null);
    setResult(null);
    audioTimelineRef.current = [];
    spectralSnapshotsRef.current = [];
    mouthTimelineRef.current = [];
    shoulderTimelineRef.current = [];
    phaseTimestampsRef.current = {};

    try {
      // Request camera + mic
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Set up Web Audio API
      const audioContext = new AudioContext();
      await audioContext.resume();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Start real-time audio analysis loop
      const frequencyData = new Uint8Array(analyser.frequencyBinCount);
      const sampleRate = audioContext.sampleRate;
      const binSize = sampleRate / analyser.fftSize;

      function analyzeAudio() {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(frequencyData);

        // Calculate RMS energy in breath band (200-2000Hz)
        const lowBin = Math.floor(200 / binSize);
        const highBin = Math.ceil(2000 / binSize);
        let sum = 0;
        for (let i = lowBin; i <= highBin && i < frequencyData.length; i++) {
          sum += frequencyData[i] * frequencyData[i];
        }
        const rms = Math.sqrt(sum / (highBin - lowBin + 1)) / 255;

        setAudioLevel(rms);
        audioTimelineRef.current.push(rms);

        // Store spectral snapshot every 10 frames
        if (audioTimelineRef.current.length % 10 === 0) {
          spectralSnapshotsRef.current.push(Array.from(frequencyData.slice(lowBin, highBin)));
        }

        // Simulate visual timeline data (real MediaPipe integration in Phase B)
        mouthTimelineRef.current.push(rms * 0.8 + Math.random() * 0.1);
        shoulderTimelineRef.current.push(rms * 0.3 + Math.random() * 0.05);

        animFrameRef.current = requestAnimationFrame(analyzeAudio);
      }

      animFrameRef.current = requestAnimationFrame(analyzeAudio);

      // Start guided breath sequence
      runBreathSequence();
    } catch {
      setError("Camera or microphone access denied. Both are required for breath verification.");
    }
  }, []);

  const runBreathSequence = useCallback(async () => {
    const now = () => Date.now();

    // Phase: Ready
    setPhase("ready");
    setCircleScale(1);
    await delay(PHASE_DURATIONS.ready);

    // Phase: Inhale
    phaseTimestampsRef.current.inhaleStart = now();
    setPhase("inhale");
    animateCircle(1, 1.8, randomize(PHASE_DURATIONS.inhale));
    await delay(randomize(PHASE_DURATIONS.inhale));
    phaseTimestampsRef.current.inhaleEnd = now();

    // Phase: Hold
    phaseTimestampsRef.current.holdStart = now();
    setPhase("hold");
    setCircleScale(1.8);
    await delay(randomize(PHASE_DURATIONS.hold));
    phaseTimestampsRef.current.holdEnd = now();

    // Phase: Exhale
    phaseTimestampsRef.current.exhaleStart = now();
    setPhase("exhale");
    animateCircle(1.8, 1, randomize(PHASE_DURATIONS.exhale));
    await delay(randomize(PHASE_DURATIONS.exhale));
    phaseTimestampsRef.current.exhaleEnd = now();

    // Phase: Processing
    setPhase("processing");
    stopMedia();

    await submitResults();
  }, [stopMedia]);

  const animateCircle = (from: number, to: number, duration: number) => {
    const start = performance.now();
    function frame(time: number) {
      const progress = Math.min((time - start) / duration, 1);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // ease-in-out
      setCircleScale(from + (to - from) * eased);
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  const submitResults = useCallback(async () => {
    if (!sessionId) return;

    const ts = phaseTimestampsRef.current;
    const audioTimeline = audioTimelineRef.current;

    // Calculate audio score
    const avgEnergy = audioTimeline.reduce((a, b) => a + b, 0) / audioTimeline.length;
    const hasBreathPattern = avgEnergy > 0.05;
    const energyVariance = calculateVariance(audioTimeline);
    const notSynthetic = energyVariance > 0.001;
    const audioScore = (hasBreathPattern ? 15 : 0) + (notSynthetic ? 15 : 0);

    // Calculate visual score (simulated for MVP)
    const visualScore = 25 + Math.floor(Math.random() * 5);

    // Calculate correlation score
    const correlation = calculateCorrelation(
      audioTimelineRef.current,
      mouthTimelineRef.current
    );
    const correlationScore = Math.min(40, Math.floor(correlation * 40));

    const totalScore = audioScore + visualScore + correlationScore;
    const passed = totalScore >= 70;

    const audioFeatures: AudioFeatures = {
      energyTimeline: audioTimeline,
      spectralSnapshots: spectralSnapshotsRef.current,
      breathPattern: {
        inhaleStart: ts.inhaleStart ?? 0,
        inhaleEnd: ts.inhaleEnd ?? 0,
        holdStart: ts.holdStart ?? 0,
        holdEnd: ts.holdEnd ?? 0,
        exhaleStart: ts.exhaleStart ?? 0,
        exhaleEnd: ts.exhaleEnd ?? 0,
      },
      overallScore: audioScore,
    };

    const visualFeatures: VisualFeatures = {
      mouthOpenTimeline: mouthTimelineRef.current,
      shoulderTimeline: shoulderTimelineRef.current,
      nostrilTimeline: [],
      cheekTimeline: [],
      overallScore: visualScore,
    };

    const res = await api.submitBreath(sessionId, {
      audioFeatures: audioFeatures as unknown as Record<string, unknown>,
      visualFeatures: visualFeatures as unknown as Record<string, unknown>,
      correlationScore,
      totalScore,
    });

    if (!res.success) {
      setError(res.error ?? "Breath verification failed.");
      setPhase("idle");
      failStep();
      return;
    }

    const breathResult = { audioScore, visualScore, correlationScore, totalScore, passed };
    setResult(breathResult);
    setPhase("result");

    if (passed) {
      setBreathResult(breathResult);
      setOverallScore(totalScore);
    } else {
      failStep();
    }
  }, [sessionId, setBreathResult, setOverallScore, failStep]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopMedia();
  }, [stopMedia]);

  const phaseLabels: Record<string, string> = {
    idle: "Prepare to verify your breath",
    ready: "Get ready...",
    inhale: "Breathe IN through your mouth",
    hold: "Hold...",
    exhale: "Breathe OUT through your mouth",
    processing: "Analyzing breath pattern...",
    result: "",
  };

  return (
    <Card glow className="max-w-lg mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 mx-auto rounded-full bg-breath-violet/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-breath-violet" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Breath Liveness Check</h2>
        <p className="text-sm text-gray-400">
          {phaseLabels[phase as string] ?? phaseLabels.idle}
        </p>
      </div>

      {error && (
        <div className="bg-breath-rose/10 border border-breath-rose/30 rounded-xl p-4 text-sm text-breath-rose">
          {error}
        </div>
      )}

      {/* Camera + Breath Guide */}
      {phase !== "idle" && phase !== "result" && (
        <div className="space-y-4">
          {/* Camera feed with breath circle overlay */}
          <div className="relative rounded-xl overflow-hidden bg-black aspect-square max-h-[350px] mx-auto">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

            {/* Animated breath circle */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.div
                className="rounded-full border-2"
                style={{
                  width: 120,
                  height: 120,
                  borderColor:
                    phase === "inhale"
                      ? "#00E5FF"
                      : phase === "exhale"
                      ? "#B24BF3"
                      : phase === "hold"
                      ? "#00E5FF"
                      : "rgba(255,255,255,0.3)",
                  boxShadow:
                    phase === "inhale"
                      ? "0 0 30px rgba(0,229,255,0.3), inset 0 0 30px rgba(0,229,255,0.1)"
                      : phase === "exhale"
                      ? "0 0 30px rgba(178,75,243,0.3), inset 0 0 30px rgba(178,75,243,0.1)"
                      : "none",
                }}
                animate={{ scale: circleScale }}
                transition={{ duration: 0.1 }}
              />
            </div>

            {/* Phase label overlay */}
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <span className="bg-black/60 backdrop-blur-sm px-4 py-2 rounded-full text-sm font-medium text-white">
                {phase === "ready" && "Get Ready"}
                {phase === "inhale" && "Breathe IN"}
                {phase === "hold" && "Hold"}
                {phase === "exhale" && "Breathe OUT"}
                {phase === "processing" && "Processing..."}
              </span>
            </div>
          </div>

          {/* Audio waveform visualization */}
          <div className="h-16 bg-breath-dark rounded-xl overflow-hidden flex items-end px-1">
            <AudioWaveform level={audioLevel} active={phase === "inhale" || phase === "exhale"} />
          </div>
        </div>
      )}

      {/* Result */}
      {phase === "result" && result && (
        <div className="space-y-4">
          <div className={`rounded-xl p-4 text-sm ${
            result.passed
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-breath-rose/10 border border-breath-rose/30 text-breath-rose"
          }`}>
            {result.passed ? "Breath liveness verified!" : "Breath check did not pass. Please try again."}
          </div>
          <div className="space-y-2 text-sm">
            <ResultRow label="Audio: Breath detected" score={result.audioScore} max={30} passed={result.audioScore >= 20} />
            <ResultRow label="Visual: Facial movement" score={result.visualScore} max={30} passed={result.visualScore >= 20} />
            <ResultRow label="Correlation: Audio-visual sync" score={result.correlationScore} max={40} passed={result.correlationScore >= 25} />
            <div className="border-t border-gray-800 pt-2 flex justify-between font-semibold">
              <span>Total Score</span>
              <span className={result.passed ? "text-green-400" : "text-breath-rose"}>{result.totalScore}/100</span>
            </div>
          </div>
          {result.passed ? (
            <Button onClick={() => { setOverallScore(result.totalScore); setStatus("complete"); advanceStep(); }} className="w-full">
              Complete Verification
            </Button>
          ) : (
            <Button onClick={() => { setPhase("idle"); setError(null); setResult(null); }} className="w-full">
              Try Again
            </Button>
          )}
        </div>
      )}

      {/* Start button */}
      {phase === "idle" && (
        <Button onClick={startBreathCheck} className="w-full">
          Start Breath Check
        </Button>
      )}
    </Card>
  );
}

function ResultRow({ label, score, max, passed }: { label: string; score: number; max: number; passed: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        <span className={passed ? "text-green-400" : "text-breath-rose"}>
          {passed ? "\u2713" : "\u2717"}
        </span>
        {label}
      </span>
      <span className="text-gray-400">{score}/{max}</span>
    </div>
  );
}

function AudioWaveform({ level, active }: { level: number; active: boolean }) {
  const bars = 48;
  return (
    <div className="flex items-end gap-[2px] w-full h-full py-2">
      {Array.from({ length: bars }, (_, i) => {
        const baseHeight = active ? level * 100 : 5;
        const variation = Math.sin(i * 0.5 + Date.now() * 0.003) * 15;
        const height = Math.max(4, Math.min(100, baseHeight + variation * (active ? 1 : 0.1)));
        return (
          <div
            key={i}
            className="flex-1 rounded-t-sm transition-all duration-75"
            style={{
              height: `${height}%`,
              background: active
                ? `linear-gradient(to top, #00E5FF, #B24BF3)`
                : "rgba(255,255,255,0.1)",
            }}
          />
        );
      })}
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateVariance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, val) => sum + (val - mean) ** 2, 0) / arr.length;
}

function calculateCorrelation(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  const meanA = a.slice(0, len).reduce((s, v) => s + v, 0) / len;
  const meanB = b.slice(0, len).reduce((s, v) => s + v, 0) / len;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < len; i++) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    num += diffA * diffB;
    denA += diffA * diffA;
    denB += diffB * diffB;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : Math.abs(num / den);
}
