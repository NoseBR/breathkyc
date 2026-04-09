"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getFaceLandmarker } from "../lib/mediapipe";
import type { FaceLandmarkerResult } from "@mediapipe/tasks-vision";

/** Full in–out cycles required to complete the breath step UI (~2–3 deep breaths) */
export const BREATH_CYCLES_REQUIRED = 3;

export interface BreathStats {
  audioVolume: number;
  mouthAperture: number;
  /** Correlation when both mouth and mic move together */
  syncScore: number;
  /** Mouth-only: visible inhale/exhale (lip separation changes) */
  mouthBreathScore: number;
  /** Audio-only: breath sounds / airflow without requiring mouth sync */
  audioBreathScore: number;
  /** Combined score — requires BOTH mouth and audio to pass */
  breathScore: number;
  /** Completed deep breath cycles (peak → valley on mouth and/or volume envelope) */
  cyclesCompleted: number;
}

function variance(arr: number[]): number {
  if (arr.length < 4) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
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
  });

  const [mouthLandmarks, setMouthLandmarks] = useState<{ x: number; y: number }[]>([]);

  const historyRef = useRef<{ vol: number; mouth: number }[]>([]);
  const comboEmaRef = useRef(0);
  const runningPeakRef = useRef(0);
  const belowLowFramesRef = useRef(0);
  const cyclesCompletedRef = useRef(0);
  const lastCycleMsRef = useRef(0);
  const requestRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const initAudio = useCallback(async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);

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
    return Math.min(rms * 12, 1);
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

      // Both modalities must be present
      setIsBreathing(mouthMotion && audibleBreath);
    } else {
      setIsBreathing(false);
    }

    // Require BOTH mouth and audio — single modality alone fails
    let breathScore: number;
    if (mouthOnlyScore > 0 && audioOnlyScore > 0) {
      // Both present: use sync if strong, otherwise weighted average of both
      breathScore = Math.round(
        Math.max(syncCorrelationScore, (mouthOnlyScore * 0.5 + audioOnlyScore * 0.5))
      );
    } else {
      // Missing one modality — cap score low so it can't pass
      breathScore = Math.round(Math.max(mouthOnlyScore, audioOnlyScore) * 0.3);
    }

    // Envelope for cycle counting: requires BOTH mouth and audio signal
    const bothActive = normAperture > 0.03 && currentVolume > 0.05;
    const envelope = bothActive
      ? Math.min(1, (normAperture * 0.5 + currentVolume * 0.5) * 1.8)
      : 0;
    comboEmaRef.current = comboEmaRef.current * 0.88 + envelope * 0.12;
    const s = comboEmaRef.current;

    if (s < 0.085) {
      belowLowFramesRef.current += 1;
      if (belowLowFramesRef.current > 12) {
        runningPeakRef.current = 0;
      }
    } else {
      belowLowFramesRef.current = 0;
      runningPeakRef.current = Math.max(runningPeakRef.current, s);
    }

    const peak = runningPeakRef.current;
    const now = performance.now();
    if (
      peak > 0.14 &&
      s < peak * 0.44 &&
      peak - s > 0.045 &&
      now - lastCycleMsRef.current > 520
    ) {
      cyclesCompletedRef.current += 1;
      lastCycleMsRef.current = now;
      runningPeakRef.current = s;
    }

    setCurrentStats({
      audioVolume: currentVolume,
      mouthAperture: normAperture,
      syncScore: Math.round(syncCorrelationScore),
      mouthBreathScore: Math.round(mouthOnlyScore),
      audioBreathScore: Math.round(audioOnlyScore),
      breathScore,
      cyclesCompleted: cyclesCompletedRef.current,
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
      comboEmaRef.current = 0;
      runningPeakRef.current = 0;
      belowLowFramesRef.current = 0;
      cyclesCompletedRef.current = 0;
      lastCycleMsRef.current = 0;
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
