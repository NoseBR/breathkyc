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
 * Checks whether a phase had real breathing by comparing breath-band energy
 * (200-2000Hz) against the idle baseline measured just before this phase.
 * Mouth opening adds ZERO energy to any frequency band → ratio ≈ 1.0 → always fails.
 */
function isPhaseValid(energies: number[], idleAvg: number): boolean {
  if (energies.length < 20) return false;

  const avg = energies.reduce((a, b) => a + b, 0) / energies.length;
  const peak = Math.max(...energies);

  // Breathing must increase energy in the 200-2000Hz band above idle.
  // Mouth opening cannot create energy → ratio = 1.0 → FAIL.
  const baseline = Math.max(idleAvg, 0.01);
  if (avg / baseline < 1.4) return false;  // avg must be 1.4× idle
  if (peak / baseline < 1.8) return false; // peak must be 1.8× idle

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

  // Idle baseline — recalculated every idle phase for comparison
  const idleVolumesRef = useRef<number[]>([]);
  const idleAvgRef = useRef(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  // Tracks whether the mic ever produced real frequency data
  const audioActiveRef = useRef(false);

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

      // iOS Safari: AudioContext starts suspended unless resumed after user gesture
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) {
      console.error("Audio Context Init Failed:", e);
    }
  }, []);

  /**
   * Computes average energy in the 200-2000 Hz band from frequency domain data.
   * Breathing produces broadband energy in this range.
   * Mouth opening without sound creates ZERO energy — physically impossible.
   * Returns 0-1 normalized band energy (dB-scaled byte avg / 255).
   */
  const getBreathBandEnergy = useCallback(() => {
    const analyser = analyserRef.current;
    const freqData = freqDataRef.current;
    if (!analyser || !freqData) return 0;

    analyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);

    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const binWidth = sampleRate / analyser.fftSize;
    const minBin = Math.floor(200 / binWidth);
    const maxBin = Math.ceil(2000 / binWidth);

    let bandSum = 0;
    let bandCount = 0;
    let totalEnergy = 0;
    for (let i = 0; i < freqData.length; i++) {
      totalEnergy += freqData[i]!;
      if (i >= minBin && i <= maxBin) {
        bandSum += freqData[i]!;
        bandCount++;
      }
    }

    // Mark audio as active if any frequency data is present
    if (totalEnergy > freqData.length * 2) audioActiveRef.current = true;

    return bandCount > 0 ? (bandSum / bandCount) / 255 : 0;
  }, []);

  const calculateSync = useCallback((results: FaceLandmarkerResult) => {
    // PRIMARY DETECTION: energy in 200-2000 Hz breath band (frequency domain).
    // This completely ignores time-domain volume — only spectral energy matters.
    const bandEnergy = getBreathBandEnergy();

    let mouthAperture = 0;
    const marks = results.faceLandmarks?.[0] as { x: number; y: number }[] | undefined;

    if (marks && marks.length >= 468 && marks[13] && marks[14] && marks[78] && marks[308]) {
      mouthAperture = Math.abs(marks[14].y - marks[13].y);
      setMouthLandmarks([marks[13], marks[14], marks[78], marks[308]]);
    } else {
      setMouthLandmarks([]);
    }

    const normAperture = Math.min(mouthAperture * 20, 1);

    historyRef.current.push({ vol: bandEnergy, mouth: normAperture });
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

    // Collect idle band energy for baseline comparison
    if (phaseRef.current === "idle") {
      idleVolumesRef.current.push(bandEnergy);
    }

    // Real-time indicator: band energy must be notably above idle baseline
    const isBreathDetected = idleAvgRef.current > 0
      ? bandEnergy > idleAvgRef.current * 1.4
      : bandEnergy > 0.20;

    if (phaseRef.current === "idle" && phaseElapsed >= PAUSE_MS) {
      // Compute idle baseline from this idle period
      const samples = idleVolumesRef.current;
      if (samples.length > 5) {
        idleAvgRef.current = samples.reduce((a, b) => a + b, 0) / samples.length;
      }
      phaseRef.current = "inhale";
      phaseStartMsRef.current = now;
      inhaleVolumesRef.current = [];
      idleVolumesRef.current = [];
    } else if (phaseRef.current === "inhale") {
      inhaleVolumesRef.current.push(bandEnergy);
      if (phaseElapsed >= INHALE_MS) {
        phaseRef.current = "exhale";
        phaseStartMsRef.current = now;
        exhaleVolumesRef.current = [];
      }
    } else if (phaseRef.current === "exhale") {
      exhaleVolumesRef.current.push(bandEnergy);
      if (phaseElapsed >= EXHALE_MS) {
        // Compare breathing audio against the idle baseline from just before.
        // HARD BLOCK: if mic never produced data, never count a cycle.
        const idle = idleAvgRef.current;
        const inhaleOk = isPhaseValid(inhaleVolumesRef.current, idle);
        const exhaleOk = isPhaseValid(exhaleVolumesRef.current, idle);
        if (audioActiveRef.current && inhaleOk && exhaleOk) {
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
      audioVolume: bandEnergy,
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
  }, [getBreathBandEnergy]);

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
      idleVolumesRef.current = [];
      idleAvgRef.current = 0;
      audioActiveRef.current = false;
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
