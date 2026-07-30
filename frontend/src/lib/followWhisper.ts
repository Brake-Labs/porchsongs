/**
 * ClientWhisperSignal: an AdvanceSignal that runs a small whisper model FULLY
 * ON-DEVICE (WebGPU via transformers.js) so Follow works on Safari and Firefox,
 * where the browser Web Speech API is unavailable. Audio never leaves the
 * device.
 *
 * Three things make this correct where a naive port would be wrong, all learned
 * from the plan review:
 *
 *  1. `t` is AUDIO time, not decode-completion time. Whisper is not a streaming
 *     model; each decode re-runs over a sliding window and finishes 0.3-2s after
 *     the words were sung. followAlign's rolling window / half-life recency math
 *     assumes `t` ≈ when-sung, so we stamp each emitted segment with
 *     `captureEpoch + segment.start`, derived from the model's own timestamps.
 *
 *  2. We do NOT reuse wordDelta (the Web Speech tail-diff). Whisper revises
 *     earlier words as context grows ("I love" -> "aisle of"), which breaks a
 *     common-prefix diff. Instead we de-dupe by SEGMENT identity (quantized
 *     audio start time) and only emit a segment once it has settled out of the
 *     re-decode overlap region.
 *
 *  3. Whisper hallucinates fluent text on music / silence. We gate segments on
 *     no-speech probability and drop non-lyric artifacts ("[Music]", "♪ ♪")
 *     before they can yank the tracker's position.
 *
 * The recognizer and the mic capture are injected, so the whole seam contract
 * (start/stop/onWords/onError/onProgress, dedupe, gating, teardown) is unit
 * testable without loading a real model or opening a real mic. The default
 * recognizer drives a Web Worker (followWhisper.worker.ts) so inference never
 * blocks the scroll on the main thread.
 */

import {
  createAudioCapture,
  TARGET_SAMPLE_RATE,
  type AudioCapture,
  type AudioCaptureFactory,
} from './followAudioCapture';
import type {
  AdvanceSignal,
  OnError,
  OnProgress,
  OnWords,
  SignalError,
} from './followSignal';

/** One timestamped chunk from the recognizer. Times are seconds within the decoded window. */
export interface WhisperSegment {
  text: string;
  /** Start time in seconds, relative to the start of the decoded window. */
  start: number;
  /** End time in seconds, relative to the start of the decoded window. */
  end: number;
  /** Model confidence that this chunk is NOT speech (0..1). Higher = likelier hallucination. */
  noSpeechProb?: number;
}

export interface WhisperRecognizer {
  /** Download + initialize the model. Reports download/init progress. */
  load(onProgress?: OnProgress): Promise<void>;
  /** Transcribe a mono 16 kHz window; returns timestamped segments. */
  transcribe(pcm: Float32Array): Promise<WhisperSegment[]>;
  /** Release the model + worker. Safe to call more than once. */
  dispose(): void;
}

export type WhisperRecognizerFactory = () => WhisperRecognizer;

export interface WhisperSignalOptions {
  now?: () => number;
  createRecognizer?: WhisperRecognizerFactory;
  createCapture?: AudioCaptureFactory;
  /** Sliding-window length in seconds (bounded so per-decode cost stays constant). */
  windowSec?: number;
  /** Minimum new audio (seconds) to accumulate before kicking another decode. */
  hopSec?: number;
  /** A segment is only emitted once its end is this far behind the window end (settled). */
  settleSec?: number;
  /** Drop segments whose no-speech probability exceeds this. */
  noSpeechThreshold?: number;
}

/** Split a transcript chunk into word tokens the aligner can normalize. */
export function tokenizeTranscript(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True for chunks that are musical / non-lyric artifacts whisper emits on
 * instrumental or silent audio (e.g. "[Music]", "(applause)", "♪ ♪", "* * *").
 * These are pure hallucination for our purposes and must not reach the tracker.
 */
export function isNonLyricArtifact(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[[(].*[)\]]$/.test(t)) return true; // fully bracketed: [Music], (applause)
  if (!/[\p{L}\p{N}]/u.test(t)) return true; // no letters/digits: "♪ ♪", "..."
  return false;
}

/** Quantize an audio-start time to a bucket key so a revised chunk maps to the same slot. */
function segmentKey(absStartSec: number): number {
  return Math.round(absStartSec * 2); // 0.5s buckets
}

const isDomException = (e: unknown, name: string): boolean =>
  typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === name;

export function createClientWhisperSignal(opts: WhisperSignalOptions = {}): AdvanceSignal {
  const now = opts.now ?? Date.now;
  const makeRecognizer = opts.createRecognizer ?? (() => createWorkerRecognizer());
  const makeCapture = opts.createCapture ?? createAudioCapture;
  const windowSamples = Math.round((opts.windowSec ?? 5) * TARGET_SAMPLE_RATE);
  const hopSamples = Math.round((opts.hopSec ?? 1) * TARGET_SAMPLE_RATE);
  const settleSec = opts.settleSec ?? 0.8;
  const noSpeechThreshold = opts.noSpeechThreshold ?? 0.6;

  let recognizer: WhisperRecognizer | null = null;
  let capture: AudioCapture | null = null;
  let stopped = false;

  // Sliding audio buffer + absolute sample bookkeeping (for audio-time stamping).
  let buffer = new Float32Array(0);
  let bufferStartSample = 0; // absolute index of buffer[0] since capture epoch
  let totalSamples = 0; // total samples ever received
  let samplesAtLastDecode = 0;
  let captureEpochMs = 0;
  let decoding = false;
  const emitted = new Set<number>();

  return {
    async start(onWords: OnWords, onError?: OnError, onProgress?: OnProgress): Promise<void> {
      stopped = false;
      buffer = new Float32Array(0);
      bufferStartSample = 0;
      totalSamples = 0;
      samplesAtLastDecode = 0;
      decoding = false;
      emitted.clear();

      if (typeof window !== 'undefined' && !window.isSecureContext) {
        onError?.({ type: 'insecure-context' });
        return;
      }

      const rec = makeRecognizer();
      recognizer = rec;
      try {
        await rec.load(onProgress);
      } catch (err) {
        const type = isDomException(err, 'InitError') ? 'model-init-failed' : 'model-download-failed';
        onError?.({ type, message: err instanceof Error ? err.message : undefined });
        rec.dispose();
        recognizer = null;
        return;
      }
      if (stopped) {
        rec.dispose();
        recognizer = null;
        return;
      }
      onProgress?.({ phase: 'ready' });

      const runDecode = async () => {
        if (stopped || decoding || !recognizer) return;
        if (buffer.length < TARGET_SAMPLE_RATE) return; // wait for >= 1s of audio
        decoding = true;
        const windowStartSec = bufferStartSample / TARGET_SAMPLE_RATE;
        const windowEndSec = totalSamples / TARGET_SAMPLE_RATE;
        const pcm = buffer.slice();
        try {
          const segments = await recognizer.transcribe(pcm);
          if (stopped) return;
          for (const seg of segments) {
            const absStartSec = windowStartSec + seg.start;
            // Only emit once the segment has settled out of the re-decode
            // overlap; later windows may still revise fresher chunks.
            if (windowEndSec - (windowStartSec + seg.end) < settleSec) continue;
            const key = segmentKey(absStartSec);
            if (emitted.has(key)) continue;
            if ((seg.noSpeechProb ?? 0) > noSpeechThreshold) continue;
            if (isNonLyricArtifact(seg.text)) continue;
            const words = tokenizeTranscript(seg.text);
            if (words.length === 0) continue;
            emitted.add(key);
            onWords({ words, t: captureEpochMs + absStartSec * 1000 });
          }
        } catch {
          /* a single failed decode is transient; the next window retries */
        } finally {
          decoding = false;
        }
      };

      const onFrame = (frame: Float32Array, t: number) => {
        if (stopped) return;
        if (captureEpochMs === 0) captureEpochMs = t;
        // Append, then bound the window from the front.
        const merged = new Float32Array(buffer.length + frame.length);
        merged.set(buffer, 0);
        merged.set(frame, buffer.length);
        totalSamples += frame.length;
        if (merged.length > windowSamples) {
          const drop = merged.length - windowSamples;
          buffer = merged.slice(drop);
          bufferStartSample += drop;
        } else {
          buffer = merged;
        }
        if (totalSamples - samplesAtLastDecode >= hopSamples) {
          samplesAtLastDecode = totalSamples;
          void runDecode();
        }
      };

      const cap = makeCapture({ now });
      capture = cap;
      captureEpochMs = 0;
      await cap.start(onFrame, (err: SignalError) => {
        if (stopped) return;
        onError?.(err);
      });
      if (stopped) cap.stop();
    },

    stop(): void {
      stopped = true;
      if (capture) {
        capture.stop();
        capture = null;
      }
      if (recognizer) {
        recognizer.dispose();
        recognizer = null;
      }
      buffer = new Float32Array(0);
      emitted.clear();
    },
  };
}

// --- Default worker-backed recognizer ------------------------------------

interface WorkerResultMsg {
  type: 'progress' | 'ready' | 'result' | 'error';
  id?: number;
  segments?: WhisperSegment[];
  progress?: { phase: 'downloading' | 'initializing' | 'ready'; fraction?: number; loaded?: number; total?: number };
  phase?: 'download' | 'init';
  message?: string;
}

/**
 * The real recognizer: a module Worker running transformers.js. Kept out of the
 * main bundle because the Worker (and its transformers.js import) only loads
 * when this factory is actually called, i.e. only when the on-device provider
 * is chosen. Not exercised by unit tests (they inject a fake recognizer).
 */
export function createWorkerRecognizer(): WhisperRecognizer {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (s: WhisperSegment[]) => void; reject: (e: unknown) => void }>();

  const ensureWorker = (): Worker => {
    if (worker) return worker;
    worker = new Worker(new URL('./followWhisper.worker.ts', import.meta.url), { type: 'module' });
    return worker;
  };

  return {
    load(onProgress?: OnProgress): Promise<void> {
      const w = ensureWorker();
      return new Promise<void>((resolve, reject) => {
        const onMessage = (e: MessageEvent<WorkerResultMsg>) => {
          const msg = e.data;
          if (msg.type === 'progress' && msg.progress) {
            onProgress?.(msg.progress);
          } else if (msg.type === 'ready') {
            w.removeEventListener('message', onMessage);
            resolve();
          } else if (msg.type === 'error') {
            w.removeEventListener('message', onMessage);
            const err = new DOMException(msg.message ?? 'load failed', msg.phase === 'init' ? 'InitError' : 'DownloadError');
            reject(err);
          }
        };
        w.addEventListener('message', onMessage);
        w.addEventListener('error', (ev) => reject(new DOMException(ev.message || 'worker error', 'InitError')), { once: true });
        w.postMessage({ type: 'load' });
      });
    },

    transcribe(pcm: Float32Array): Promise<WhisperSegment[]> {
      const w = ensureWorker();
      const id = nextId++;
      return new Promise<WhisperSegment[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const onMessage = (e: MessageEvent<WorkerResultMsg>) => {
          const msg = e.data;
          if (msg.type === 'result' && msg.id === id) {
            w.removeEventListener('message', onMessage);
            pending.delete(id);
            resolve(msg.segments ?? []);
          } else if (msg.type === 'error' && msg.id === id) {
            w.removeEventListener('message', onMessage);
            pending.delete(id);
            reject(new Error(msg.message ?? 'transcribe failed'));
          }
        };
        w.addEventListener('message', onMessage);
        // Transfer the PCM buffer to avoid a copy across the worker boundary.
        w.postMessage({ type: 'transcribe', id, pcm }, [pcm.buffer]);
      });
    },

    dispose(): void {
      if (worker) {
        worker.terminate();
        worker = null;
      }
      pending.clear();
    },
  };
}
