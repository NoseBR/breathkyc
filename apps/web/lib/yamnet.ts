/**
 * YAMNet — Google's pre-trained audio event classifier (521 classes).
 * Runs in-browser via TensorFlow.js.  Class 36 = "Breathing".
 *
 * Lazy-loaded so the main bundle stays small.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let tf: typeof import("@tensorflow/tfjs") | null = null;
let model: any = null;
let ready = false;

const YAMNET_MODEL_URL =
  "https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1";
const BREATHING_CLASS_INDEX = 36;
const NUM_CLASSES = 521;

export async function loadYAMNet(): Promise<boolean> {
  if (ready) return true;
  try {
    tf = await import("@tensorflow/tfjs");
    model = await tf.loadGraphModel(YAMNET_MODEL_URL, { fromTFHub: true });
    ready = true;
    console.log("YAMNet loaded");
    return true;
  } catch (e) {
    console.error("YAMNet load failed:", e);
    return false;
  }
}

export function isYAMNetReady(): boolean {
  return ready;
}

/**
 * Run YAMNet on a 16 kHz mono Float32Array and return the
 * average "Breathing" class confidence (0–1).
 */
export async function getBreathingConfidence(
  audioSamples: Float32Array
): Promise<number> {
  if (!tf || !model) return 0;

  try {
    const input = tf.tensor1d(audioSamples);
    const output = model.predict(input) as any;

    const scores = Array.isArray(output) ? output[0] : output;
    const data: Float32Array = await scores.data();

    input.dispose();
    if (Array.isArray(output)) output.forEach((t: any) => t.dispose());
    else output.dispose();

    const numFrames = Math.max(1, Math.floor(data.length / NUM_CLASSES));
    let sum = 0;
    for (let f = 0; f < numFrames; f++) {
      sum += data[f * NUM_CLASSES + BREATHING_CLASS_INDEX]!;
    }
    return sum / numFrames;
  } catch (e) {
    console.error("YAMNet inference error:", e);
    return 0;
  }
}

/** Naive nearest-neighbour downsample. */
export function downsampleAudio(
  buffer: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const len = Math.floor(buffer.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = buffer[Math.floor(i * ratio)]!;
  }
  return out;
}
