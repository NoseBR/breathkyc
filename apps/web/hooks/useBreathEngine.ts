"use client";

import { useRef, useState, useCallback } from "react";
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
  /** Countdown seconds remaining in current phase (5→1), 0 when idle */
  phaseCountdown: number;
}

/**
 * Compute RMS (root-mean-square) energy of raw PCM samples.
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
 * Base mic gain for exhale / idle phases.
 */
const MIC_GAIN = 20.0;

/**
 * Boosted mic gain during inhale phase only.
 * Inhales are naturally quieter — extra amplification helps.
 */
const MIC_GAIN_INHALE = 40.0;

/**
 * Fallback minimum RMS threshold (before adaptive calibration kicks in).
 * After idle phase calibration, threshold = max(this, noiseFloor × 2.5).
 */
const RMS_MIN_THRESHOLD = 0.002;

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
    phaseCountdown: 0,
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

  // Latest RMS from audio analysis
  const latestRmsRef = useRef(0);

  // Adaptive noise floor
  const noiseFloorRef = useRef(0);
  const noiseCalibrationRef = useRef<number[]>([]);
  const noiseCalibrated = useRef(false);
  const breathThresholdRef = useRef(RMS_MIN_THRESHOLD);

  // Peak scores tracked over entire exercise — used for API submission
  const peakMouthScoreRef = useRef(0);
  const peakAudioScoreRef = useRef(0);
  const peakSyncScoreRef = useRef(0);

  // Audio pipeline refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const initAudio = useCallback(async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);

      // Amplify mic signal — 8x boost for quiet breathing on phone mics
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = MIC_GAIN;
      source.connect(gainNode);

      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        const rms = computeRMS(input);
        latestRmsRef.current = rms;
      };

      gainNode.connect(processor);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      audioContextRef.current = audioCtx;
      processorRef.current = processor;
      gainNodeRef.current = gainNode;
      console.log("[BreathEngine] Audio initialized. SampleRate:", audioCtx.sampleRate, "Gain:", MIC_GAIN);
    } catch (e) {
      console.error("[BreathEngine] Audio Init Failed:", e);
    }
  }, []);

  const calculateSync = useCallback((results: FaceLandmarkerResult) => {
    const rms = latestRmsRef.current;
    const threshold = breathThresholdRef.current;

    const isBreathDetected = rms > threshold;

    let mouthAperture = 0;
    const marks = results.faceLandmarks?.[0] as { x: number; y: number }[] | undefined;

    if (marks && marks.length >= 468 && marks[13] && marks[14] && marks[78] && marks[308]) {
      mouthAperture = Math.abs(marks[14].y - marks[13].y);
      setMouthLandmarks([marks[13], marks[14], marks[78], marks[308]]);
    } else {
      setMouthLandmarks([]);
    }

    const normAperture = Math.min(mouthAperture * 20, 1);

    // Scoring
    const mouthOnlyScore = normAperture > 0.042 ? Math.min(100, 28 + normAperture * 88) : 0;
    const audioOnlyScore = isBreathDetected ? Math.min(100, 28 + rms * 2000) : 0;

    let syncScore = 0;
    let breathScore = 0;

    if (mouthOnlyScore > 0 && audioOnlyScore > 0) {
      syncScore = Math.round((mouthOnlyScore + audioOnlyScore) / 2);
      breathScore = syncScore;
    }

    // Track peak scores over the entire exercise
    if (mouthOnlyScore > peakMouthScoreRef.current) peakMouthScoreRef.current = mouthOnlyScore;
    if (audioOnlyScore > peakAudioScoreRef.current) peakAudioScoreRef.current = audioOnlyScore;
    if (syncScore > peakSyncScoreRef.current) peakSyncScoreRef.current = syncScore;

    setIsBreathing(normAperture > 0.042 && isBreathDetected);

    // --- Guided breath phase tracking ---
    const INHALE_MS = 5000;
    const EXHALE_MS = 5000;
    const PAUSE_MS = 2000;

    const now = performance.now();
    if (phaseStartMsRef.current === 0) phaseStartMsRef.current = now;
    const phaseElapsed = now - phaseStartMsRef.current;

    if (phaseRef.current === "idle") {
      noiseCalibrationRef.current.push(rms);
      if (phaseElapsed >= PAUSE_MS) {
        const samples = noiseCalibrationRef.current;
        if (samples.length > 10) {
          const avgNoise = samples.reduce((a, b) => a + b, 0) / samples.length;
          noiseFloorRef.current = avgNoise;
          breathThresholdRef.current = Math.max(RMS_MIN_THRESHOLD, avgNoise * 1.8);
          if (!noiseCalibrated.current) {
            console.log("[BreathEngine] Noise calibrated:",
              "floor=", avgNoise.toFixed(5),
              "threshold=", breathThresholdRef.current.toFixed(5));
            noiseCalibrated.current = true;
          }
        }
        noiseCalibrationRef.current = [];
        phaseRef.current = "inhale";
        phaseStartMsRef.current = now;
        inhaleRmsRef.current = [];
        // Boost mic gain for inhale
        if (gainNodeRef.current) gainNodeRef.current.gain.value = MIC_GAIN_INHALE;
      }
    } else if (phaseRef.current === "inhale") {
      inhaleRmsRef.current.push(rms);
      if (phaseElapsed >= INHALE_MS) {
        phaseRef.current = "exhale";
        phaseStartMsRef.current = now;
        exhaleRmsRef.current = [];
        // Restore normal gain for exhale
        if (gainNodeRef.current) gainNodeRef.current.gain.value = MIC_GAIN;
      }
    } else if (phaseRef.current === "exhale") {
      exhaleRmsRef.current.push(rms);
      if (phaseElapsed >= EXHALE_MS) {
        const t = breathThresholdRef.current;
        const inhaleValues = inhaleRmsRef.current;
        const exhaleValues = exhaleRmsRef.current;

        const inhaleAbove = inhaleValues.filter(v => v > t).length;
        const exhaleAbove = exhaleValues.filter(v => v > t).length;

        const inhaleRatio = inhaleValues.length > 0 ? inhaleAbove / inhaleValues.length : 0;
        const exhaleRatio = exhaleValues.length > 0 ? exhaleAbove / exhaleValues.length : 0;

        const inhaleOk = inhaleRatio >= 0.25;
        const exhaleOk = exhaleRatio >= 0.25;

        if (inhaleOk && exhaleOk) {
          cyclesCompletedRef.current += 1;
          console.log("[BreathEngine] ✅ CYCLE COUNTED",
            `| inhale: ${(inhaleRatio*100).toFixed(0)}%`,
            `| exhale: ${(exhaleRatio*100).toFixed(0)}%`,
            `| threshold=${t.toFixed(5)}`);
        } else {
          console.log("[BreathEngine] ❌ CYCLE REJECTED",
            `| inhale: ${(inhaleRatio*100).toFixed(0)}%`,
            `| exhale: ${(exhaleRatio*100).toFixed(0)}%`,
            `| threshold=${t.toFixed(5)}`);
        }

        phaseRef.current = "idle";
        phaseStartMsRef.current = now;
      }
    }

    const pe = now - phaseStartMsRef.current;
    let phaseProgress = 0;
    let phaseCountdown = 0;
    if (phaseRef.current === "idle") {
      phaseProgress = Math.min(1, pe / PAUSE_MS);
    } else if (phaseRef.current === "inhale") {
      phaseProgress = Math.min(1, pe / INHALE_MS);
      phaseCountdown = Math.max(1, Math.ceil((INHALE_MS - pe) / 1000));
    } else {
      phaseProgress = Math.min(1, pe / EXHALE_MS);
      phaseCountdown = Math.max(1, Math.ceil((EXHALE_MS - pe) / 1000));
    }

    // Use PEAK scores (accumulated over exercise) for the stats that get sent to API
    setCurrentStats({
      audioVolume: rms,
      mouthAperture: normAperture,
      syncScore: Math.round(peakSyncScoreRef.current),
      mouthBreathScore: Math.round(peakMouthScoreRef.current),
      audioBreathScore: Math.round(peakAudioScoreRef.current),
      breathScore: Math.round(peakSyncScoreRef.current),
      cyclesCompleted: cyclesCompletedRef.current,
      breathPhase: phaseRef.current,
      phaseProgress,
      breathingDetected: isBreathDetected,
      audioRms: rms,
      phaseCountdown,
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
      noiseFloorRef.current = 0;
      noiseCalibrationRef.current = [];
      noiseCalibrated.current = false;
      breathThresholdRef.current = RMS_MIN_THRESHOLD;
      peakMouthScoreRef.current = 0;
      peakAudioScoreRef.current = 0;
      peakSyncScoreRef.current = 0;
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
