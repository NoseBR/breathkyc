"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getFaceLandmarker } from "../lib/mediapipe";
import { loadYAMNet, getBreathingConfidence, downsampleAudio } from "../lib/yamnet";
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
  /** YAMNet (or fallback) detected breathing sound */
  breathingDetected: boolean;
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
  const inhaleAudioFramesRef = useRef(0);
  const exhaleAudioFramesRef = useRef(0);

  // YAMNet audio classification
  const breathingConfidenceRef = useRef(0);
  const yamnetReadyRef = useRef(false);
  const yamnetBufferRef = useRef<Float32Array[]>([]);
  const yamnetSamplesRef = useRef(0);
  const yamnetInferringRef = useRef(false);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nativeRateRef = useRef(44100);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const initAudio = useCallback(async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);

      // AnalyserNode — RMS volume for the visual indicator
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);

      // ScriptProcessorNode — capture raw PCM for YAMNet
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      source.connect(processor);
      const silentOutput = audioCtx.createGain();
      silentOutput.gain.value = 0;
      processor.connect(silentOutput);
      silentOutput.connect(audioCtx.destination);

      nativeRateRef.current = audioCtx.sampleRate;
      const samplesNeeded = Math.ceil(audioCtx.sampleRate * 0.975); // ~960 ms

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const channelData = e.inputBuffer.getChannelData(0);
        yamnetBufferRef.current.push(new Float32Array(channelData));
        yamnetSamplesRef.current += channelData.length;

        if (yamnetSamplesRef.current >= samplesNeeded && !yamnetInferringRef.current) {
          yamnetInferringRef.current = true;

          // Concatenate accumulated chunks
          const totalLen = yamnetBufferRef.current.reduce((a, b) => a + b.length, 0);
          const full = new Float32Array(totalLen);
          let off = 0;
          for (const buf of yamnetBufferRef.current) { full.set(buf, off); off += buf.length; }
          yamnetBufferRef.current = [];
          yamnetSamplesRef.current = 0;

          const downsampled = downsampleAudio(full, nativeRateRef.current, 16000);
          getBreathingConfidence(downsampled)
            .then((c) => { breathingConfidenceRef.current = c; yamnetInferringRef.current = false; })
            .catch(() => { yamnetInferringRef.current = false; });
        }
      };

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      processorRef.current = processor;
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

    // --- Guided breath phase detection ---
    // Timed phases prompt inhale → exhale. Audio must be detected
    // in BOTH phases for a cycle to count.
    const INHALE_MS = 3500;
    const EXHALE_MS = 3500;
    const PAUSE_MS = 1500;
    const AUDIO_PHASE_THRESHOLD = 0.15;
    const MIN_PHASE_AUDIO = 12;

    const now = performance.now();
    if (phaseStartMsRef.current === 0) phaseStartMsRef.current = now;
    const phaseElapsed = now - phaseStartMsRef.current;

    // YAMNet ML detection if available, otherwise fall back to volume threshold
    const isBreathDetected = yamnetReadyRef.current
      ? breathingConfidenceRef.current > 0.25
      : currentVolume > AUDIO_PHASE_THRESHOLD;

    if (phaseRef.current === "idle" && phaseElapsed >= PAUSE_MS) {
      phaseRef.current = "inhale";
      phaseStartMsRef.current = now;
      inhaleAudioFramesRef.current = 0;
    } else if (phaseRef.current === "inhale") {
      if (isBreathDetected) inhaleAudioFramesRef.current += 1;
      if (phaseElapsed >= INHALE_MS) {
        phaseRef.current = "exhale";
        phaseStartMsRef.current = now;
        exhaleAudioFramesRef.current = 0;
      }
    } else if (phaseRef.current === "exhale") {
      if (isBreathDetected) exhaleAudioFramesRef.current += 1;
      if (phaseElapsed >= EXHALE_MS) {
        if (inhaleAudioFramesRef.current >= MIN_PHASE_AUDIO &&
            exhaleAudioFramesRef.current >= MIN_PHASE_AUDIO) {
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
      inhaleAudioFramesRef.current = 0;
      exhaleAudioFramesRef.current = 0;
      breathingConfidenceRef.current = 0;
      yamnetBufferRef.current = [];
      yamnetSamplesRef.current = 0;
      yamnetInferringRef.current = false;
      setCurrentStats((prev) => ({ ...prev, cyclesCompleted: 0 }));

      await initAudio(stream);

      // Load YAMNet + face landmarker in parallel
      const [, yamnetOk] = await Promise.all([
        getFaceLandmarker(),
        loadYAMNet(),
      ]);
      yamnetReadyRef.current = yamnetOk;

      setEngineReady(true);
      requestRef.current = requestAnimationFrame(predictLoop);
    },
    [initAudio, predictLoop]
  );

  const stopEngine = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
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
