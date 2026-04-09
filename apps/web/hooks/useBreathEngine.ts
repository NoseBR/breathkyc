"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getFaceLandmarker } from "../lib/mediapipe";
import { classifyBreath, loadBreathClassifier, type BreathClass } from "../lib/breathClassifier";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

/** Full in–out cycles required to complete the breath step UI */
export const BREATH_CYCLES_REQUIRED = 3;

export type BreathPhase = "idle" | "inhale" | "exhale";

export interface BreathStats {
  audioVolume: number;
  mouthAperture: number;
  syncScore: number;
  mouthBreathScore: number;
  audioBreathScore: number;
  breathScore: number;
  cyclesCompleted: number;
  breathPhase: BreathPhase;
  phaseProgress: number;
  breathingDetected: boolean;
}

function variance(arr: number[]): number {
  if (arr.length < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
}

/**
 * Checks whether a guided phase had real breathing using ML classifications.
 * Each classification is { label, confidence }.
 * Phase is valid if enough HIGH-CONFIDENCE classifications match the expected breath type.
 */
function isPhaseValidML(
  classifications: { label: BreathClass; confidence: number }[],
  expectedType: "inhale" | "exhale"
): boolean {
  // Need minimum samples to be meaningful
  if (classifications.length < 3) return false;

  // Only consider classifications with confidence > 0.55
  const confident = classifications.filter((c) => c.confidence > 0.55);
  if (confident.length < 2) return false;

  const breathCount = confident.filter(
    (c) => c.label === expectedType
  ).length;
  const ratio = breathCount / confident.length;

  // At least 50% of confident classifications must match the expected type
  return ratio >= 0.50;
}

export function useBreathEngine(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [engineReady, setEngineReady] = useState(false);
  const [isBreathing, setIsBreathing] = useState(false);
  const [currentStats, setCurrentStats] = useState<BreathStats>({
    audioVolume: 0,
    mouthAperture: 0,
    syncScore: 0,
    mouthBreathScore: 0,
    audioBreathScore: 0,
    breathScore: 0,
    cyclesCompleted: 0,
    breathPhase: "idle" as BreathPhase,
    phaseProgress: 0,
    breathingDetected: false,
  });

  const [mouthLandmarks, setMouthLandmarks] = useState<{ x: number; y: number }[]>([]);

  const historyRef = useRef<{ vol: number; mouth: number }[]>([]);
  const cyclesCompletedRef = useRef(0);
  const requestRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);

  // Guided breathing phase tracking
  const phaseRef = useRef<BreathPhase>("idle");
  const phaseStartMsRef = useRef(0);

  // ML classification results collected during each phase (label + confidence)
  const inhaleClassesRef = useRef<{ label: BreathClass; confidence: number }[]>([]);
  const exhaleClassesRef = useRef<{ label: BreathClass; confidence: number }[]>([]);

  // Latest ML classification result (updated every ~250ms)
  const latestClassRef = useRef<BreathClass>("silence");
  const latestConfidenceRef = useRef(0);
  const classifierActiveRef = useRef(false);

  // Track how many successful ML inferences have run
  const classifySuccessCountRef = useRef(0);

  // Audio pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const classifyTimerRef = useRef<number>(0);

  /**
   * Initialize audio pipeline: ScriptProcessorNode collects raw samples
   * for ML classification (no AnalyserNode, no volume thresholds).
   */
  const initAudio = useCallback(async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);

      // ScriptProcessorNode collects raw PCM audio for ML inference
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        audioChunksRef.current.push(new Float32Array(input));
        // Keep max 2 seconds of audio chunks
        const maxChunks = Math.ceil((audioCtx.sampleRate * 2) / bufferSize);
        while (audioChunksRef.current.length > maxChunks) {
          audioChunksRef.current.shift();
        }
      };

      source.connect(processor);
      // Silent output to keep processor alive
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      audioContextRef.current = audioCtx;
      processorRef.current = processor;
    } catch (e) {
      console.error("Audio Init Failed:", e);
    }
  }, []);

  /**
   * Start the ML classification loop — runs every 250ms.
   * Takes the last 0.25s of audio, computes MFCCs, runs ONNX model.
   */
  const startClassificationLoop = useCallback(() => {
    classifyTimerRef.current = window.setInterval(async () => {
      const sampleRate = audioContextRef.current?.sampleRate || 44100;
      const samplesNeeded = Math.floor(sampleRate * 0.25);
      const chunks = audioChunksRef.current;

      // Check if we have enough audio
      const totalSamples = chunks.reduce((s, c) => s + c.length, 0);
      if (totalSamples < samplesNeeded) return;

      // Extract last 0.25s of mono audio
      const combined = new Float32Array(samplesNeeded);
      let writePos = samplesNeeded;
      for (let i = chunks.length - 1; i >= 0 && writePos > 0; i--) {
        const chunk = chunks[i]!;
        const copyLen = Math.min(chunk.length, writePos);
        combined.set(chunk.subarray(chunk.length - copyLen), writePos - copyLen);
        writePos -= copyLen;
      }

      try {
        const result = await classifyBreath(combined, sampleRate);
        latestClassRef.current = result.label;
        latestConfidenceRef.current = result.confidence;
        classifierActiveRef.current = true;
        classifySuccessCountRef.current += 1;
      } catch (e) {
        console.error("[BreathEngine] Classification error:", e);
        // Reset to silence on error so stale values don't replay
        latestClassRef.current = "silence";
        latestConfidenceRef.current = 0;
      }
    }, 250);
  }, []);

  const calculateSync = useCallback((results: FaceLandmarkerResult) => {
    const mlClass = latestClassRef.current;
    const mlConfidence = latestConfidenceRef.current;

    // Convert ML class to a 0-1 "breath signal" for scoring
    const breathSignal = mlClass === "inhale" || mlClass === "exhale"
      ? mlConfidence
      : 0;

    let mouthAperture = 0;
    const marks = results.faceLandmarks?.[0] as { x: number; y: number }[] | undefined;

    if (marks && marks.length >= 468 && marks[13] && marks[14] && marks[78] && marks[308]) {
      mouthAperture = Math.abs(marks[14].y - marks[13].y);
      setMouthLandmarks([marks[13], marks[14], marks[78], marks[308]]);
    } else {
      setMouthLandmarks([]);
    }

    const normAperture = Math.min(mouthAperture * 20, 1);

    historyRef.current.push({ vol: breathSignal, mouth: normAperture });
    if (historyRef.current.length > 100) historyRef.current.shift();

    const len = historyRef.current.length;
    const vols = historyRef.current.map((h) => h.vol);
    const mouths = historyRef.current.map((h) => h.mouth);
    const maxV = len ? Math.max(...vols) : 0;
    const maxM = len ? Math.max(...mouths) : 0;
    const vV = variance(vols);
    const vM = variance(mouths);

    let syncCorrelationScore = 0;
    let mouthOnlyScore = 0;
    let audioOnlyScore = 0;

    if (len > 35) {
      const audibleBreath = maxV > 0.3;
      const mouthMotion = maxM > 0.042;

      if (mouthMotion) {
        mouthOnlyScore = Math.min(100, 28 + vM * 7500 + maxM * 88);
      }
      if (audibleBreath) {
        audioOnlyScore = Math.min(100, 28 + vV * 11000 + maxV * 100);
      }

      if (mouthMotion && audibleBreath) {
        let varianceSum = 0;
        historyRef.current.forEach((point) => {
          varianceSum += Math.abs(point.vol - point.mouth);
        });
        const avgDiff = varianceSum / len;
        syncCorrelationScore = Math.max(0, Math.min(100, 100 - avgDiff * 135));
      }

      setIsBreathing(mouthMotion && audibleBreath);
    } else {
      setIsBreathing(false);
    }

    let breathScore: number;
    if (mouthOnlyScore > 0 && audioOnlyScore > 0) {
      breathScore = Math.round(
        Math.max(syncCorrelationScore, (mouthOnlyScore * 0.5 + audioOnlyScore * 0.5))
      );
    } else {
      breathScore = Math.round(Math.max(mouthOnlyScore, audioOnlyScore) * 0.3);
    }

    // --- Guided breath phase detection using ML classifications ---
    const INHALE_MS = 3500;
    const EXHALE_MS = 3500;
    const PAUSE_MS = 2000;

    const now = performance.now();
    if (phaseStartMsRef.current === 0) phaseStartMsRef.current = now;
    const phaseElapsed = now - phaseStartMsRef.current;

    // Real-time indicator: ML model says breathing is happening
    const isBreathDetected = mlClass === "inhale" || mlClass === "exhale";

    if (phaseRef.current === "idle" && phaseElapsed >= PAUSE_MS) {
      phaseRef.current = "inhale";
      phaseStartMsRef.current = now;
      inhaleClassesRef.current = [];
    } else if (phaseRef.current === "inhale") {
      // Collect ML classifications during inhale phase (with confidence)
      inhaleClassesRef.current.push({ label: mlClass, confidence: mlConfidence });
      if (phaseElapsed >= INHALE_MS) {
        phaseRef.current = "exhale";
        phaseStartMsRef.current = now;
        exhaleClassesRef.current = [];
      }
    } else if (phaseRef.current === "exhale") {
      exhaleClassesRef.current.push({ label: mlClass, confidence: mlConfidence });
      if (phaseElapsed >= EXHALE_MS) {
        // ML-based validation: check if the model detected breathing during each phase.
        // Deduplicate: since calculateSync runs at 60fps but ML updates at 4Hz,
        // we get ~14 classifications per 3.5s phase from the ML model.
        // The same classification is repeated across ~15 frames. Deduplicate by
        // sampling every ~15th entry.
        type ClassEntry = { label: BreathClass; confidence: number };
        const dedup = (arr: ClassEntry[]) => {
          const step = Math.max(1, Math.floor(arr.length / 14));
          const result: ClassEntry[] = [];
          for (let i = 0; i < arr.length; i += step) result.push(arr[i]!);
          return result;
        };

        const inhaleDeduped = dedup(inhaleClassesRef.current);
        const exhaleDeduped = dedup(exhaleClassesRef.current);

        const inhaleOk = isPhaseValidML(inhaleDeduped, "inhale");
        const exhaleOk = isPhaseValidML(exhaleDeduped, "exhale");

        // Require ML classifier to have run successfully at least 5 times
        // AND BOTH phases must pass validation (no weak fallbacks)
        if (classifierActiveRef.current && classifySuccessCountRef.current >= 5
            && inhaleOk && exhaleOk) {
          cyclesCompletedRef.current += 1;
          console.log("[BreathEngine] Cycle counted — inhale + exhale ML-validated");
        } else if (classifierActiveRef.current) {
          console.log("[BreathEngine] Cycle REJECTED — inhaleOk:", inhaleOk, "exhaleOk:", exhaleOk,
            "successCount:", classifySuccessCountRef.current);
        }

        phaseRef.current = "idle";
        phaseStartMsRef.current = now;
      }
    }

    const pe = now - phaseStartMsRef.current;
    let phaseProgress = 0;
    if (phaseRef.current === "idle") phaseProgress = Math.min(1, pe / PAUSE_MS);
    else if (phaseRef.current === "inhale") phaseProgress = Math.min(1, pe / INHALE_MS);
    else phaseProgress = Math.min(1, pe / EXHALE_MS);

    setCurrentStats({
      audioVolume: breathSignal,
      mouthAperture: normAperture,
      syncScore: Math.round(syncCorrelationScore),
      mouthBreathScore: Math.round(mouthOnlyScore),
      audioBreathScore: Math.round(audioOnlyScore),
      breathScore,
      cyclesCompleted: cyclesCompletedRef.current,
      breathPhase: phaseRef.current,
      phaseProgress,
      breathingDetected: isBreathDetected,
    });
  }, []);

  const predictLoop = useCallback(async () => {
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      const landmarker = await getFaceLandmarker();
      const startTimeMs = performance.now();
      if (lastVideoTimeRef.current !== video.currentTime) {
        lastVideoTimeRef.current = video.currentTime;
        const results = landmarker.detectForVideo(video, startTimeMs);
        calculateSync(results);
      }
    }
    requestRef.current = requestAnimationFrame(predictLoop);
  }, [calculateSync, videoRef]);

  const startEngine = useCallback(
    async (stream: MediaStream) => {
      historyRef.current = [];
      cyclesCompletedRef.current = 0;
      phaseRef.current = "idle";
      phaseStartMsRef.current = 0;
      inhaleClassesRef.current = [];
      exhaleClassesRef.current = [];
      audioChunksRef.current = [];
      latestClassRef.current = "silence";
      latestConfidenceRef.current = 0;
      classifierActiveRef.current = false;
      classifySuccessCountRef.current = 0;
      setCurrentStats((prev) => ({ ...prev, cyclesCompleted: 0 }));

      // Load ML model + audio + face in parallel
      await Promise.all([
        loadBreathClassifier(),
        initAudio(stream),
        getFaceLandmarker(),
      ]);

      setEngineReady(true);
      startClassificationLoop();
      requestRef.current = requestAnimationFrame(predictLoop);
    },
    [initAudio, predictLoop, startClassificationLoop]
  );

  const stopEngine = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (classifyTimerRef.current) clearInterval(classifyTimerRef.current);
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current?.state !== "closed") {
      void audioContextRef.current?.close();
    }
    setEngineReady(false);
  }, []);

  return {
    engineReady,
    isBreathing,
    currentStats,
    mouthLandmarks,
    startEngine,
    stopEngine,
  };
}
