"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getFaceLandmarker } from "../lib/mediapipe";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

/** Full in–out cycles required to complete the breath step UI (~2–3 deep breaths) */
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
  /** 0–1 progress through the current phase */
  phaseProgress: number;
  /** Real-time: is the current audio loud enough to be breathing? */
  breathingDetected: boolean;
}

function variance(arr: number[]): number {
  if (arr.length < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
}

/**
 * Checks whether a phase had real breathing using noise-subtracted analysis.
 * Subtracts the calibrated noise floor so ambient noise becomes ~0.
 * Mouth-only motion adds zero audio → all net values ≈ 0 → always fails.
 */
function isPhaseValid(volumes: number[], noiseFloor: number): boolean {
  if (volumes.length < 20) return false;

  // 1. Subtract noise floor — only count signal ABOVE ambient
  const nf = Math.max(noiseFloor, 0.03); // minimum floor even in silent rooms
  const netVolumes = volumes.map(v => Math.max(0, v - nf));

  const netAvg = netVolumes.reduce((a, b) => a + b, 0) / netVolumes.length;
  const netPeak = Math.max(...netVolumes);
  const netStdDev = Math.sqrt(
    netVolumes.reduce((s, v) => s + (v - netAvg) ** 2, 0) / netVolumes.length
  );

  // Net thresholds: signal above ambient must be substantial
  if (netAvg < 0.10) return false;   // sustained sound above noise
  if (netPeak < 0.20) return false;  // clear peak above noise
  if (netStdDev < 0.03) return false; // variation (not flat hum)

  // 2. Frame coverage: ≥40% of frames must be clearly above noise floor
  const clearThreshold = nf * 1.8;
  const framesAbove = volumes.filter(v => v > clearThreshold).length;
  if (framesAbove / volumes.length < 0.40) return false;

  // 3. Raw volume hard floor — absolute minimum regardless of noise floor
  const rawAvg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  if (rawAvg < 0.15) return false;

  return true;
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
  const inhaleVolumesRef = useRef<number[]>([]);
  const exhaleVolumesRef = useRef<number[]>([]);

  // Noise floor calibration — measured during first idle phase
  const noiseFloorRef = useRef(0);
  const noiseFloorSamplesRef = useRef<number[]>([]);
  const noiseFloorCalibratedRef = useRef(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const initAudio = useCallback(async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);

      // High-pass filter removes mic self-noise, AGC artifacts, and low-freq hum
      const highpass = audioCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;
      highpass.Q.value = 0.7;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(highpass);
      highpass.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      console.error("Audio Context Init Failed:", e);
    }
  }, []);

  const getRMSVolume = useCallback(() => {
    const data = dataArrayRef.current;
    if (!data || !analyserRef.current) return 0;

    let sum = 0;
    analyserRef.current.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);

    for (let i = 0; i < data.length; i++) {
      const value = data[i]!;
      const amplitude = (value - 128) / 128.0;
      sum += amplitude * amplitude;
    }
    const rms = Math.sqrt(sum / data.length);
    return Math.min(rms * 8, 1);
  }, []);

  const calculateSync = useCallback((results: FaceLandmarkerResult) => {
    const currentVolume = getRMSVolume();

    let mouthAperture = 0;
    const marks = results.faceLandmarks?.[0] as { x: number; y: number }[] | undefined;

    if (marks && marks.length >= 468 && marks[13] && marks[14] && marks[78] && marks[308]) {
      mouthAperture = Math.abs(marks[14].y - marks[13].y);
      setMouthLandmarks([marks[13], marks[14], marks[78], marks[308]]);
    } else {
      setMouthLandmarks([]);
    }

    const normAperture = Math.min(mouthAperture * 20, 1);

    historyRef.current.push({ vol: currentVolume, mouth: normAperture });
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
      const audibleBreath = maxV > 0.06;
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

    // --- Guided breath phase detection ---
    // Each phase collects all volume readings. At phase end, statistical
    // analysis determines if real breathing occurred (avg, peak, stddev).
    const INHALE_MS = 3500;
    const EXHALE_MS = 3500;
    const PAUSE_MS = 2000;

    const now = performance.now();
    if (phaseStartMsRef.current === 0) phaseStartMsRef.current = now;
    const phaseElapsed = now - phaseStartMsRef.current;

    // Noise floor calibration during idle phase
    if (phaseRef.current === "idle" && !noiseFloorCalibratedRef.current) {
      noiseFloorSamplesRef.current.push(currentVolume);
      if (noiseFloorSamplesRef.current.length >= 60) {
        const sorted = [...noiseFloorSamplesRef.current].sort((a, b) => a - b);
        noiseFloorRef.current = sorted[Math.floor(sorted.length * 0.95)]!;
        noiseFloorCalibratedRef.current = true;
      }
    }

    // Real-time indicator for UI (adaptive to noise floor)
    const liveThreshold = Math.max(0.25, noiseFloorRef.current * 2.5);
    const isBreathDetected = currentVolume > liveThreshold;

    if (phaseRef.current === "idle" && phaseElapsed >= PAUSE_MS) {
      phaseRef.current = "inhale";
      phaseStartMsRef.current = now;
      inhaleVolumesRef.current = [];
    } else if (phaseRef.current === "inhale") {
      inhaleVolumesRef.current.push(currentVolume);
      if (phaseElapsed >= INHALE_MS) {
        phaseRef.current = "exhale";
        phaseStartMsRef.current = now;
        exhaleVolumesRef.current = [];
      }
    } else if (phaseRef.current === "exhale") {
      exhaleVolumesRef.current.push(currentVolume);
      if (phaseElapsed >= EXHALE_MS) {
        // Statistical check: was there REAL breathing during both phases?
        const nf = noiseFloorRef.current;
        const inhaleOk = isPhaseValid(inhaleVolumesRef.current, nf);
        const exhaleOk = isPhaseValid(exhaleVolumesRef.current, nf);
        if (inhaleOk && exhaleOk) {
          cyclesCompletedRef.current += 1;
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
      audioVolume: currentVolume,
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
  }, [getRMSVolume]);

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
      inhaleVolumesRef.current = [];
      exhaleVolumesRef.current = [];
      noiseFloorRef.current = 0;
      noiseFloorSamplesRef.current = [];
      noiseFloorCalibratedRef.current = false;
      setCurrentStats((prev) => ({ ...prev, cyclesCompleted: 0 }));

      await initAudio(stream);
      await getFaceLandmarker();
      setEngineReady(true);
      requestRef.current = requestAnimationFrame(predictLoop);
    },
    [initAudio, predictLoop]
  );

  const stopEngine = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
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
