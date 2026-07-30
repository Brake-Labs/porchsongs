/**
 * Whisper inference Worker for the on-device Follow recognizer.
 *
 * Runs transformers.js off the main thread so decode never janks the scroll.
 * Loaded lazily by createWorkerRecognizer (followWhisper.ts) only when the
 * on-device provider is chosen, so transformers.js + onnxruntime-web stay out
 * of the main app bundle. WebGPU first, WASM fallback.
 *
 * Protocol (main <-> worker):
 *   in:  { type: 'load' }
 *        { type: 'transcribe', id, pcm: Float32Array }   // 16 kHz mono
 *   out: { type: 'progress', progress }
 *        { type: 'ready' }
 *        { type: 'result', id, segments }
 *        { type: 'error', id?, phase: 'download'|'init', message }
 */

import { pipeline, env } from '@huggingface/transformers';
import type { WhisperSegment } from './followWhisper';

// THE FEASIBILITY KNOB. Start with the smallest English model (fastest; latency
// is the bigger risk than WER for rough line alignment) and only move up if the
// on-device accuracy bar needs it. Known-good transformers.js ids to try during
// the feasibility gate:
//   'onnx-community/whisper-tiny.en'   (webgpu-optimized dtypes)
//   'Xenova/whisper-tiny.en'           (widely mirrored fallback)
//   'onnx-community/whisper-base'      (multilingual, more accurate, slower)
// Timestamps are required (we stamp tokens with audio time, not decode time).
const MODEL = 'onnx-community/whisper-tiny.en';

// Fetch models from the Hub; do not look for local files in the app's assets.
env.allowLocalModels = false;

type AsrOutput = { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>;

let asr: Asr | null = null;

function post(msg: unknown, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

async function load(): Promise<void> {
  const progress_callback = (p: { status?: string; progress?: number; loaded?: number; total?: number }) => {
    if (p.status === 'progress') {
      post({
        type: 'progress',
        progress: {
          phase: 'downloading',
          fraction: typeof p.progress === 'number' ? p.progress / 100 : undefined,
          loaded: p.loaded,
          total: p.total,
        },
      });
    } else if (p.status === 'ready' || p.status === 'done') {
      post({ type: 'progress', progress: { phase: 'initializing' } });
    }
  };

  try {
    asr = (await pipeline('automatic-speech-recognition', MODEL, {
      device: 'webgpu',
      dtype: 'fp32',
      progress_callback,
    })) as unknown as Asr;
  } catch {
    // WebGPU unavailable or failed to init: fall back to WASM so we at least run.
    asr = (await pipeline('automatic-speech-recognition', MODEL, {
      progress_callback,
    })) as unknown as Asr;
  }
  post({ type: 'ready' });
}

function toSegments(out: AsrOutput): WhisperSegment[] {
  if (!out.chunks || out.chunks.length === 0) {
    const text = out.text?.trim();
    return text ? [{ text, start: 0, end: 0 }] : [];
  }
  return out.chunks.map((c) => ({
    text: c.text,
    start: c.timestamp[0] ?? 0,
    end: c.timestamp[1] ?? c.timestamp[0] ?? 0,
  }));
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; id?: number; pcm?: Float32Array };
  if (msg.type === 'load') {
    try {
      await load();
    } catch (err) {
      post({ type: 'error', phase: asr ? 'init' : 'download', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === 'transcribe' && msg.pcm) {
    if (!asr) {
      post({ type: 'error', id: msg.id, phase: 'init', message: 'model not loaded' });
      return;
    }
    try {
      const out = await asr(msg.pcm, { return_timestamps: true, chunk_length_s: 30 });
      const first = Array.isArray(out) ? out[0]! : out;
      post({ type: 'result', id: msg.id, segments: toSegments(first) });
    } catch (err) {
      post({ type: 'error', id: msg.id, phase: 'init', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
