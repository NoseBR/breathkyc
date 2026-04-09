"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getFaceLandmarker } from "../lib/mediapipe";
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
  /** Raw microphone RMS energy (0–1). Silent ≈ 0.001, breathing ≈ 0.01–0.1 */
  audioRms: number;
}

/**
 * Compute RMS (root-mean-square) energy of raw PCM samples.
 * This is the most direct measure of audio loudness — no FFT, no ML.
 */
function computeRMS(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]! * samples[i]!;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Minimum RMS energy for audio to be considered "real sound".
 * Mic electronic self-noise is typically 0.001–0.003.
 * Audible breathing is typically 0.008–0.1.
 * This threshold MUST be above mic noise floor.
 */
const RMS_BREATH_THRESHOLD = 0.007;

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
    audioRms: 0,
  });

  const [mouthLandmarks, setMouthLandmarks] = useState<{ x: number; y: number }[]>([]);

  const cyclesCompletedRef = useRef(0);
  const requestRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);

  // Guided breathing phase tracking
  const phaseRef = useRef<BreathPhase>("idle");
  const phaseStartMsRef = useRef(0);

  // RMS energy values collected during each phase
  const inhaleRmsRef = useRef<number[]>([]);
  const exhaleRmsRef = useRef<number[]>([]);

  // Latest RMS from audio analysis (updated every ~93ms from ScriptProcessor)
  const latestRmsRef = useRef(0);

  // Audio pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  /**
   * Initialize audio pipeline: ScriptProcessorNode computes RMS
   * on every buffer callback (~93ms at 44.1kHz with 4096 buffer).
   * This is raw PCM energy — no ML, no FFT, no thresholds that can be gamed.
   */
  const initAudio = useCallback(async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);

      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        const rms = computeRMS(input);
        latestRmsRef.current = rms;
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
      console.log("[BreathEngine] Audio initialized. SampleRate:", audioCtx.sampleRate);
    } catch (e) {
      console.error("[BreathEngine] Audio Init Failed:", e);
    }
  }, []);

  const calculateSync = useCallback((results: FaceLandmarkerResult) => {
    const rms = latestRmsRef.current;

    // breathingDetected = raw audio energy is above the noise floor
    const isBreathDetected = rms > RMS_BREATH_THRESHOLD;

    let mouthAperture = 0;
    const marks = results.faceLandmarks?.[0] as { x: number; y: number }[] | undefined;

    if (marks && marks.length >= 468 && marks[13] && marks[14] && marks[78] && marks[308]) {
      mouthAperture = Math.abs(marks[14].y - marks[13].y);
      setMouthLandmarks([marks[13], marks[14], marks[78], marks[308]]);
    } else {
      setMouthLandmarks([]);
    }

    const normAperture = Math.min(mouthAperture * 20, 1);

    // Scoring — only give audio score if RMS is above threshold
    const mouthOnlyScore = normAperture > 0.042 ? Math.min(100, 28 + normAperture * 88) : 0;
    const audioOnlyScore = isBreathDetected ? Math.min(100, 28 + rms * 3000) : 0;
    const syncCorrelationScore = (mouthOnlyScore > 0 && audioOnlyScore > 0)
      ? Math.round((mouthOnlyScore + audioOnlyScore) / 2)
      : 0;

    let breathScore: number;
    if (mouthOnlyScore > 0 && audioOnlyScore > 0) {
      breathScore = Math.round(syncCorrelationScore);
    } else {
      breathScore = 0; // ZERO if either modality missing
    }

    setIsBreathing(normAperture > 0.042 && isBreathDetected);

    // --- Guided breath phase tracking ---
    const INHALE_MS = 3500;
    const EXHALE_MS = 3500;
    const PAUSE_MS = 2000;

    const now = performance.now();
    if (phaseStartMsRef.current === 0) phaseStartMsRef.current = now;
    const phaseElapsed = now - phaseStartMsRef.current;

    if (phaseRef.current === "idle" && phaseElapsed >= PAUSE_MS) {
      phaseRef.current = "inhale";
      phaseStartMsRef.current = now;
      inhaleRmsRef.current = [];
    } else if (phaseRef.current === "inhale") {
      // Collect RMS values during inhale
      inhaleRmsRef.current.push(rms);
      if (phaseElapsed >= INHALE_MS) {
        phaseRef.current = "exhale";
        phaseStartMsRef.current = now;
        exhaleRmsRef.current = [];
      }
    } else if (phaseRef.current === "exhale") {
      // Collect RMS values during exhale
      exhaleRmsRef.current.push(rms);
      if (phaseElapsed >= EXHALE_MS) {
        // === CYCLE VALIDATION ===
        // Both phases must have SUSTAINED audio energy above the noise floor.
        // This uses raw PCM RMS — the most direct measurement possible.
        // Opening your mouth without sound produces RMS ≈ 0.001 (electronic noise only).
        // Real breathing produces RMS ≈ 0.01–0.1.

        const inhaleValues = inhaleRmsRef.current;
        const exhaleValues = exhaleRmsRef.current;

        // Count how many RMS samples exceeded the threshold in each phase
        const inhaleAbove = inhaleValues.filter(v => v > RMS_BREATH_THRESHOLD).length;
        const exhaleAbove = exhaleValues.filter(v => v > RMS_BREATH_THRESHOLD).length;

        // Require at least 30% of samples above threshold in EACH phase
        const inhaleRatio = inhaleValues.length > 0 ? inhaleAbove / inhaleValues.length : 0;
        const exhaleRatio = exhaleValues.length > 0 ? exhaleAbove / exhaleValues.length : 0;

        const inhaleAvgRms = inhaleValues.length > 0
          ? inhaleValues.reduce((a, b) => a + b, 0) / inhaleValues.length : 0;
        const exhaleAvgRms = exhaleValues.length > 0
          ? exhaleValues.reduce((a, b) => a + b, 0) / exhaleValues.length : 0;

        const inhaleOk = inhaleRatio >= 0.30 && inhaleAvgRms > RMS_BREATH_THRESHOLD * 0.7;
        const exhaleOk = exhaleRatio >= 0.30 && exhaleAvgRms > RMS_BREATH_THRESHOLD * 0.7;

        if (inhaleOk && exhaleOk) {
          cyclesCompletedRef.current += 1;
          console.log(
            "[BreathEngine] ✅ CYCLE COUNTED",
            `| inhale: ratio=${(inhaleRatio*100).toFixed(0)}% avgRMS=${inhaleAvgRms.toFixed(4)}`,
            `| exhale: ratio=${(exhaleRatio*100).toFixed(0)}% avgRMS=${exhaleAvgRms.toFixed(4)}`
          );
        } else {
          console.log(
            "[BreathEngine] ❌ CYCLE REJECTED",
            `| inhaleOk=${inhaleOk} (ratio=${(inhaleRatio*100).toFixed(0)}% avgRMS=${inhaleAvgRms.toFixed(4)})`,
            `| exhaleOk=${exhaleOk} (ratio=${(exhaleRatio*100).toFixed(0)}% avgRMS=${exhaleAvgRms.toFixed(4)})`,
            `| threshold=${RMS_BREATH_THRESHOLD}`
          );
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
      audioVolume: rms,
      mouthAperture: normAperture,
      syncScore: Math.round(syncCorrelationScore),
      mouthBreathScore: Math.round(mouthOnlyScore),
      audioBreathScore: Math.round(audioOnlyScore),
      breathScore,
      cyclesCompleted: cyclesCompletedRef.current,
      breathPhase: phaseRef.current,
      phaseProgress,
      breathingDetected: isBreathDetected,
      audioRms: rms,
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
      cyclesCompletedRef.current = 0;
      phaseRef.current = "idle";
      phaseStartMsRef.current = 0;
      inhaleRmsRef.current = [];
      exhaleRmsRef.current = [];
      latestRmsRef.current = 0;
      setCurrentStats((prev) => ({ ...prev, cyclesCompleted: 0 }));

      await Promise.all([
        initAudio(stream),
        getFaceLandmarker(),
      ]);

      setEngineReady(true);
      requestRef.current = requestAnimationFrame(predictLoop);
    },
    [initAudio, predictLoop]
  );

  const stopEngine = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
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
