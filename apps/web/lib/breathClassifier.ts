/**
 * ML-based breath classifier using ONNX Runtime Web (WASM backend).
 * Runs a 3-layer LSTM trained on breathing audio to classify:
 *   0 = Exhale, 1 = Inhale, 2 = Silence
 *
 * Uses WASM execution provider — no WebGL conflict with MediaPipe.
 * Model: Breathing-Classification (tomaszsankowski) exported to ONNX.
 */

import * as ort from "onnxruntime-web";

// Force WASM backend — WebGL would conflict with MediaPipe
ort.env.wasm.numThreads = 1;

export type BreathClass = "exhale" | "inhale" | "silence";

const CLASS_MAP: Record<number, BreathClass> = {
  0: "exhale",
  1: "inhale",
  2: "silence",
};

let session: ort.InferenceSession | null = null;
let loading = false;

/**
 * Load the ONNX breath classifier model (singleton).
 */
export async function loadBreathClassifier(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (loading) {
    // Wait for in-progress load
    while (loading) await new Promise((r) => setTimeout(r, 100));
    return session!;
  }

  loading = true;
  try {
    session = await ort.InferenceSession.create("/models/breath_classifier.onnx", {
      executionProviders: ["wasm"],
    });
    console.log("[BreathClassifier] ONNX model loaded (WASM)");
    return session;
  } catch (e) {
    console.error("[BreathClassifier] Failed to load ONNX model:", e);
    throw e;
  } finally {
    loading = false;
  }
}

/**
 * Compute 20 MFCCs from a Float32Array of audio samples.
 * Reimplements the core of librosa.feature.mfcc with default params.
 */
function computeMFCCs(
  samples: Float32Array,
  sampleRate: number,
  nMfcc = 20,
  nFft = 2048,
  hopLength = 512,
  nMels = 128
): Float32Array[] {
  const frames: Float32Array[] = [];
  const numFrames = Math.floor((samples.length - nFft) / hopLength) + 1;
  if (numFrames <= 0) return [];

  // Pre-compute Hann window
  const window = new Float32Array(nFft);
  for (let i = 0; i < nFft; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / nFft));
  }

  // Mel filterbank
  const fftBins = nFft / 2 + 1;
  const melFilters = createMelFilterbank(sampleRate, nFft, nMels, fftBins);

  // DCT matrix for MFCC
  const dctMatrix = createDCTMatrix(nMfcc, nMels);

  // Process each frame
  for (let f = 0; f < numFrames; f++) {
    const start = f * hopLength;

    // Apply window and compute FFT magnitude
    const windowed = new Float32Array(nFft);
    for (let i = 0; i < nFft; i++) {
      windowed[i] = (samples[start + i] || 0) * window[i]!;
    }

    const mag = fftMagnitude(windowed);

    // Power spectrum
    const power = new Float32Array(fftBins);
    for (let i = 0; i < fftBins; i++) {
      power[i] = mag[i]! * mag[i]!;
    }

    // Mel spectrum
    const melSpec = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      let sum = 0;
      for (let k = 0; k < fftBins; k++) {
        sum += melFilters[m]![k]! * power[k]!;
      }
      melSpec[m] = Math.max(sum, 1e-10);
    }

    // Log mel spectrum
    const logMel = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      logMel[m] = Math.log(melSpec[m]!);
    }

    // DCT to get MFCCs
    const mfcc = new Float32Array(nMfcc);
    for (let c = 0; c < nMfcc; c++) {
      let sum = 0;
      for (let m = 0; m < nMels; m++) {
        sum += dctMatrix[c]![m]! * logMel[m]!;
      }
      mfcc[c] = sum;
    }

    frames.push(mfcc);
  }

  return frames;
}

/** Mel frequency conversion */
function hzToMel(hz: number): number {
  return 2595.0 * Math.log10(1 + hz / 700.0);
}
function melToHz(mel: number): number {
  return 700.0 * (Math.pow(10, mel / 2595.0) - 1);
}

/** Create mel filterbank matrix */
function createMelFilterbank(
  sr: number,
  nFft: number,
  nMels: number,
  fftBins: number
): Float32Array[] {
  const fMin = 0;
  const fMax = sr / 2;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);

  const melPoints = new Float32Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melToHz(melMin + (i * (melMax - melMin)) / (nMels + 1));
  }

  const fftFreqs = new Float32Array(fftBins);
  for (let i = 0; i < fftBins; i++) {
    fftFreqs[i] = (i * sr) / nFft;
  }

  const filters: Float32Array[] = [];
  for (let m = 0; m < nMels; m++) {
    const filter = new Float32Array(fftBins);
    const left = melPoints[m]!;
    const center = melPoints[m + 1]!;
    const right = melPoints[m + 2]!;

    for (let k = 0; k < fftBins; k++) {
      const freq = fftFreqs[k]!;
      if (freq >= left && freq <= center) {
        filter[k] = (freq - left) / (center - left);
      } else if (freq > center && freq <= right) {
        filter[k] = (right - freq) / (right - center);
      }
    }
    filters.push(filter);
  }

  return filters;
}

/** Create DCT-II matrix */
function createDCTMatrix(nMfcc: number, nMels: number): Float32Array[] {
  const matrix: Float32Array[] = [];
  for (let c = 0; c < nMfcc; c++) {
    const row = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      row[m] = Math.cos((Math.PI * c * (m + 0.5)) / nMels);
    }
    matrix.push(row);
  }
  return matrix;
}

/** Simple in-place radix-2 FFT returning magnitude spectrum */
function fftMagnitude(signal: Float32Array): Float32Array {
  const n = signal.length;
  // Zero-pad to power of 2 if needed
  let size = 1;
  while (size < n) size <<= 1;

  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let i = 0; i < n; i++) real[i] = signal[i]!;

  // Bit-reverse permutation
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imag[i], imag[j]] = [imag[j]!, imag[i]!];
    }
  }

  // Cooley-Tukey FFT
  for (let len = 2; len <= size; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < size; i += len) {
      let curReal = 1;
      let curImag = 0;

      for (let j = 0; j < halfLen; j++) {
        const tReal = curReal * real[i + j + halfLen]! - curImag * imag[i + j + halfLen]!;
        const tImag = curReal * imag[i + j + halfLen]! + curImag * real[i + j + halfLen]!;

        real[i + j + halfLen] = real[i + j]! - tReal;
        imag[i + j + halfLen] = imag[i + j]! - tImag;
        real[i + j] = real[i + j]! + tReal;
        imag[i + j] = imag[i + j]! + tImag;

        const newCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurReal;
      }
    }
  }

  // Magnitude of first half + 1
  const mag = new Float32Array(size / 2 + 1);
  for (let i = 0; i <= size / 2; i++) {
    mag[i] = Math.sqrt(real[i]! * real[i]! + imag[i]! * imag[i]!);
  }
  return mag;
}

/**
 * Classify a chunk of audio samples as inhale, exhale, or silence.
 * @param samples Float32Array of mono audio samples (0.25s at sampleRate)
 * @param sampleRate Audio sample rate (typically 44100 or 48000)
 */
export async function classifyBreath(
  samples: Float32Array,
  sampleRate: number
): Promise<{ label: BreathClass; confidence: number; logits: Float32Array }> {
  const sess = await loadBreathClassifier();

  // Compute MFCCs: 20 coefficients × N time frames
  const mfccFrames = computeMFCCs(samples, sampleRate);
  if (mfccFrames.length === 0) {
    return { label: "silence", confidence: 1.0, logits: new Float32Array([0, 0, 1]) };
  }

  const nMfcc = 20;
  const nFrames = mfccFrames.length;

  // Build tensor: shape [1, 20, nFrames] (batch, mfcc_coeffs, time)
  const tensorData = new Float32Array(nMfcc * nFrames);
  for (let c = 0; c < nMfcc; c++) {
    for (let t = 0; t < nFrames; t++) {
      tensorData[c * nFrames + t] = mfccFrames[t]![c]!;
    }
  }

  const inputTensor = new ort.Tensor("float32", tensorData, [1, nMfcc, nFrames]);
  const results = await sess.run({ mfcc_input: inputTensor });
  const logits = results["class_logits"]!.data as Float32Array;

  // Softmax
  const maxLogit = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - maxLogit));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((v) => v / sumExp);

  let bestIdx = 0;
  let bestProb = probs[0]!;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i]! > bestProb) {
      bestIdx = i;
      bestProb = probs[i]!;
    }
  }

  return {
    label: CLASS_MAP[bestIdx] || "silence",
    confidence: bestProb,
    logits: new Float32Array(logits),
  };
}
