/**
 * Shared microphone -> 16 kHz mono PCM capture for Follow mode.
 *
 * This is deliberately dual-purpose:
 *   1. The `?followdebug` harness records raw audio with it, so a real sung
 *      session can be replayed through an offline recognizer to measure latency,
 *      WER, and hallucination (the token-only recording cannot do that).
 *   2. It is the front half of the on-device whisper signal (followWhisper.ts):
 *      the exact same capture feeds the recognizer.
 *
 * It mirrors useTuner's lifecycle discipline (secure-context guard, mobile
 * AudioContext resume, cancelledRef teardown, the SignalError taxonomy) so the
 * two mic paths behave identically. Inference and the tracker live elsewhere;
 * this module only produces Float32 PCM frames on a callback.
 */

import type { OnError, SignalError } from './followSignal';

/** Target rate for whisper and the recorded WAV. Whisper expects 16 kHz mono. */
export const TARGET_SAMPLE_RATE = 16000;

export type OnAudioFrame = (frame: Float32Array, t: number) => void;

export interface AudioCapture {
  /**
   * Begin capturing. Resolves once the mic is live (permission granted).
   * `onFrame` receives mono Float32 PCM already downsampled to 16 kHz, with `t`
   * the capture-clock time (ms) of the frame's first sample.
   */
  start(onFrame: OnAudioFrame, onError?: OnError): Promise<void>;
  /** Stop and release the mic + audio graph. Safe to call more than once. */
  stop(): void;
}

export interface AudioCaptureOptions {
  targetSampleRate?: number;
  /** Clock for frame timestamps (default Date.now). Injectable for tests. */
  now?: () => number;
}

/**
 * Downsample (or pass through) a mono Float32 buffer to `targetRate` with linear
 * interpolation. We resample explicitly rather than trusting
 * `new AudioContext({ sampleRate })`, which several browsers (notably Safari)
 * silently ignore, leaving the graph at the hardware rate.
 */
export function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
  targetRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (inputRate === targetRate || input.length === 0) return input;
  if (inputRate < targetRate) return input; // never upsample; whisper tolerates >=16k poorly, but this is a safety floor
  const ratio = inputRate / targetRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = pos - lo;
    out[i] = input[lo]! * (1 - frac) + input[hi]! * frac;
  }
  return out;
}

/** Concatenate Float32 chunks into one buffer (for finalizing a recording). */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Encode mono Float32 PCM as a 16-bit WAV blob. This is the artifact the harness
 * downloads so the exact audio can be fed to an offline recognizer.
 */
export function encodeWav(pcm: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): Blob {
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

type MediaDevicesLike = {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
};

function mapCaptureError(err: unknown): SignalError {
  if (err instanceof DOMException) {
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      return { type: 'not-found', message: err.message };
    }
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return { type: 'permission-denied', message: err.message };
    }
  }
  return { type: 'permission-denied', message: err instanceof Error ? err.message : undefined };
}

/**
 * The browser capture. Constructing it is side-effect free; `start()` opens the
 * mic and builds the audio graph, so tests that never call start() (or that
 * inject their own capture) do not need AudioContext/getUserMedia.
 */
export function createAudioCapture(opts: AudioCaptureOptions = {}): AudioCapture {
  const targetRate = opts.targetSampleRate ?? TARGET_SAMPLE_RATE;
  const now = opts.now ?? Date.now;

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let stopped = false;

  return {
    async start(onFrame: OnAudioFrame, onError?: OnError): Promise<void> {
      stopped = false;
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        onError?.({ type: 'insecure-context' });
        return;
      }
      const md: MediaDevicesLike | undefined = navigator.mediaDevices;
      if (!md?.getUserMedia) {
        onError?.({ type: 'unsupported' });
        return;
      }

      let s: MediaStream;
      try {
        s = await md.getUserMedia({ audio: true });
      } catch (err) {
        onError?.(mapCaptureError(err));
        return;
      }
      if (stopped) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;

      const AudioCtor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtor();
      if (audioCtx.state === 'suspended') {
        try {
          await audioCtx.resume();
        } catch {
          /* best effort; some browsers need a user gesture */
        }
      }
      ctx = audioCtx;

      source = audioCtx.createMediaStreamSource(s);
      // ScriptProcessorNode is deprecated but universally supported (incl. iOS
      // Safari, where AudioWorklet + WASM threads are the least reliable). The
      // callback only copies + downsamples a small buffer; the heavy inference
      // runs in a Worker, so this main-thread hop is negligible.
      const proc = audioCtx.createScriptProcessor(4096, 1, 1);
      processor = proc;
      const inputRate = audioCtx.sampleRate;

      proc.onaudioprocess = (e: AudioProcessingEvent) => {
        if (stopped) return;
        const channel = e.inputBuffer.getChannelData(0);
        // Copy: the underlying buffer is reused by the audio thread.
        const frame = downsampleTo16k(new Float32Array(channel), inputRate, targetRate);
        onFrame(frame, now());
      };

      source.connect(proc);
      // ScriptProcessor only fires when connected to a destination.
      proc.connect(audioCtx.destination);
    },

    stop(): void {
      stopped = true;
      if (processor) {
        processor.onaudioprocess = null;
        try {
          processor.disconnect();
        } catch {
          /* noop */
        }
        processor = null;
      }
      if (source) {
        try {
          source.disconnect();
        } catch {
          /* noop */
        }
        source = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      if (ctx) {
        ctx.close().catch(() => {});
        ctx = null;
      }
    },
  };
}

export type AudioCaptureFactory = (opts?: AudioCaptureOptions) => AudioCapture;
