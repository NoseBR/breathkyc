"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getFaceLandmarker } from "../lib/mediapipe";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";

interface LivenessStats {
  blinkDetected: boolean;
  microMovements: boolean;
  depthValid: boolean;
  score: number;
}

export function useFaceMesh(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [landmarks, setLandmarks] = useState<unknown[]>([]); // raw landmark data for drawing
  
  const [liveness, setLiveness] = useState<LivenessStats>({
    blinkDetected: false,
    microMovements: false,
    depthValid: false,
    score: 0,
  });

  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const requestRef = useRef<number>(0);
  const lastVideoTimeRef = useRef<number>(-1);

  // Liveness Tracking State
  const blinkHistoryRef = useRef<number[]>([]);
  const noseHistoryRef = useRef<{x: number, y: number}[]>([]);
  const depthHistoryRef = useRef<number[]>([]);

  const checkLiveness = useCallback((result: FaceLandmarkerResult) => {
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      setFaceDetected(false);
      setLandmarks([]);
      return;
    }

    const marks = result.faceLandmarks[0] as {x: number, y: number, z: number}[] | undefined;
    if (!marks || marks.length < 468) return;
    
    setFaceDetected(true);
    setLandmarks(marks);

    // 1. BLINK DETECTION (Dist between 159-145 and 386-374)
    const lEyeTop = marks[159]!;
    const lEyeBot = marks[145]!;
    const rEyeTop = marks[386]!;
    const rEyeBot = marks[374]!;
    const leftEyeDist = Math.abs(lEyeTop.y - lEyeBot.y);
    const rightEyeDist = Math.abs(rEyeTop.y - rEyeBot.y);
    const eyeOpenness = (leftEyeDist + rightEyeDist) / 2;
    
    blinkHistoryRef.current.push(eyeOpenness);
    if (blinkHistoryRef.current.length > 20) blinkHistoryRef.current.shift();

    // Sudden drop in distance = blink
    const minOpenness = Math.min(...blinkHistoryRef.current);
    const maxOpenness = Math.max(...blinkHistoryRef.current);
    const hasBlinked = maxOpenness > 0 && (minOpenness / maxOpenness) < 0.6;

    // 2. MICRO MOVEMENTS (Nose tip 1 tracking)
    const nose = marks[1]!;
    noseHistoryRef.current.push({ x: nose.x, y: nose.y });
    if (noseHistoryRef.current.length > 30) noseHistoryRef.current.shift();
    
    let varianceX = 0, varianceY = 0;
    if (noseHistoryRef.current.length > 10) {
      const avgX = noseHistoryRef.current.reduce((sum, p) => sum + p.x, 0) / noseHistoryRef.current.length;
      const avgY = noseHistoryRef.current.reduce((sum, p) => sum + p.y, 0) / noseHistoryRef.current.length;
      varianceX = noseHistoryRef.current.reduce((sum, p) => sum + Math.pow(p.x - avgX, 2), 0) / noseHistoryRef.current.length;
      varianceY = noseHistoryRef.current.reduce((sum, p) => sum + Math.pow(p.y - avgY, 2), 0) / noseHistoryRef.current.length;
    }
    const hasMicroMovements =
      (varianceX > 0.000003 && varianceX < 0.03) && (varianceY > 0.000003 && varianceY < 0.03);

    // 3. DEPTH ESTIMATION (3D Validation using Z coord relative bounding)
    // Marks have x, y, z. Z is depth.
    depthHistoryRef.current.push(nose.z);
    if (depthHistoryRef.current.length > 30) depthHistoryRef.current.shift();
    
    const depthVariance = Math.max(...depthHistoryRef.current) - Math.min(...depthHistoryRef.current);
    const is3D = Math.abs(nose.z) > 0.01 && depthVariance > 0.001; // Not entirely flat over time

    setLiveness(prev => {
      const b = prev.blinkDetected || hasBlinked;
      const m = prev.microMovements || hasMicroMovements;
      const d = prev.depthValid || is3D;
      
      let baseScore = 35; // baseline when a face mesh is tracked
      let score = baseScore + (b ? 25 : 0) + (m ? 25 : 0) + (d ? 25 : 0);

      return {
        blinkDetected: b,
        microMovements: m,
        depthValid: d,
        score
      };
    });
  }, []);

  const predictLoop = useCallback(() => {
    const video = videoRef.current;
    if (video && landmarkerRef.current && video.readyState >= 2) {
      let startTimeMs = performance.now();
      if (lastVideoTimeRef.current !== video.currentTime) {
        lastVideoTimeRef.current = video.currentTime;
        const results = landmarkerRef.current.detectForVideo(video, startTimeMs);
        checkLiveness(results);
      }
    }
    requestRef.current = requestAnimationFrame(predictLoop);
  }, [checkLiveness, videoRef]);

  useEffect(() => {
    let unmounted = false;

    async function init() {
      try {
        const landmarker = await getFaceLandmarker();
        if (unmounted) return;
        landmarkerRef.current = landmarker;
        setIsLoaded(true);
        requestRef.current = requestAnimationFrame(predictLoop);
      } catch (e) {
        console.error("Hook initialization failed:", e);
      }
    }

    init();

    return () => {
      unmounted = true;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [predictLoop]);

  return { isLoaded, faceDetected, liveness, landmarks };
}
