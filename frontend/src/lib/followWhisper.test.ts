import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createClientWhisperSignal,
  tokenizeTranscript,
  isNonLyricArtifact,
  type WhisperRecognizer,
  type WhisperSegment,
} from './followWhisper';
import type { AudioCapture, OnAudioFrame } from './followAudioCapture';
import type { OnError, OnWords, SignalProgress } from './followSignal';

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

/** A capture we can drive frame-by-frame from the test. */
function fakeCapture() {
  let onFrame: OnAudioFrame | null = null;
  const stop = vi.fn();
  const capture: AudioCapture = {
    start: async (cb) => {
      onFrame = cb;
    },
    stop,
  };
  return {
    capture,
    stop,
    push: (samples: number, t: number) => onFrame?.(new Float32Array(samples), t),
  };
}

/** A recognizer that returns scripted segments, one script entry per decode call. */
function fakeRecognizer(scripts: WhisperSegment[][], loadImpl?: (p?: (x: SignalProgress) => void) => Promise<void>) {
  let call = 0;
  const dispose = vi.fn();
  const transcribe = vi.fn(async () => scripts[Math.min(call++, scripts.length - 1)] ?? []);
  const rec: WhisperRecognizer = {
    load: loadImpl ?? (async () => {}),
    transcribe,
    dispose,
  };
  return { rec, dispose, transcribe };
}

describe('tokenizeTranscript / isNonLyricArtifact', () => {
  it('lowercases, strips punctuation, keeps words', () => {
    expect(tokenizeTranscript('Hold me, now!')).toEqual(['hold', 'me', 'now']);
  });
  it('flags bracketed and symbol-only chunks as non-lyric', () => {
    expect(isNonLyricArtifact('[Music]')).toBe(true);
    expect(isNonLyricArtifact('(applause)')).toBe(true);
    expect(isNonLyricArtifact('♪ ♪')).toBe(true);
    expect(isNonLyricArtifact('   ')).toBe(true);
    expect(isNonLyricArtifact('hold me now')).toBe(false);
  });
});

describe('createClientWhisperSignal — seam contract', () => {
  it('stamps t from AUDIO time (capture epoch + segment start), not decode time', async () => {
    const cap = fakeCapture();
    const { rec } = fakeRecognizer([[{ text: 'hold me', start: 0, end: 0.2, noSpeechProb: 0 }]]);
    const signal = createClientWhisperSignal({
      createCapture: () => cap.capture,
      createRecognizer: () => rec,
      windowSec: 4,
      hopSec: 1,
      settleSec: 0.8,
    });
    const words: { words: string[]; t: number }[] = [];
    const onWords: OnWords = (tok) => words.push(tok);
    await signal.start(onWords);

    // First frame establishes the capture epoch (t = 5000). 1s of audio triggers a decode.
    cap.push(16000, 5000);
    await vi.waitFor(() => expect(words.length).toBe(1));
    expect(words[0]!.words).toEqual(['hold', 'me']);
    // segment start 0 -> t is exactly the capture epoch, NOT "now".
    expect(words[0]!.t).toBe(5000);
    signal.stop();
  });

  it('de-dupes a revised segment by audio-start bucket (no wordDelta double-count)', async () => {
    const cap = fakeCapture();
    // Decode 1: "hold" at t=0. Decode 2: whisper REVISES the same slot to "hold on".
    const { rec, transcribe } = fakeRecognizer([
      [{ text: 'hold', start: 0, end: 0.2, noSpeechProb: 0 }],
      [{ text: 'hold on', start: 0, end: 0.3, noSpeechProb: 0 }],
    ]);
    const signal = createClientWhisperSignal({
      createCapture: () => cap.capture,
      createRecognizer: () => rec,
      windowSec: 10,
      hopSec: 1,
      settleSec: 0.8,
    });
    const words: string[][] = [];
    await signal.start((tok) => words.push(tok.words));

    cap.push(16000, 1000);
    await vi.waitFor(() => expect(words.length).toBe(1));
    cap.push(16000, 2000);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));

    // The revised bucket-0 segment must NOT be emitted again.
    expect(words).toEqual([['hold']]);
    signal.stop();
  });

  it('gates hallucinations: drops non-lyric artifacts and high no-speech chunks', async () => {
    const cap = fakeCapture();
    const { rec } = fakeRecognizer([
      [
        { text: '[Music]', start: 0, end: 0.1, noSpeechProb: 0 },
        { text: 'la la', start: 0.1, end: 0.15, noSpeechProb: 0.9 },
      ],
    ]);
    const signal = createClientWhisperSignal({
      createCapture: () => cap.capture,
      createRecognizer: () => rec,
      windowSec: 4,
      hopSec: 1,
      settleSec: 0.8,
      noSpeechThreshold: 0.6,
    });
    const words: string[][] = [];
    await signal.start((tok) => words.push(tok.words));

    cap.push(16000, 0);
    await vi.waitFor(() => expect(rec.transcribe).toHaveBeenCalled());
    // Give any (incorrect) emission a chance to land, then assert none did.
    await Promise.resolve();
    expect(words).toEqual([]);
    signal.stop();
  });

  it('does not emit an unsettled segment near the window end', async () => {
    const cap = fakeCapture();
    // end=0.9 in a 1s window: 1 - 0.9 = 0.1 < settle 0.8 -> hold it back.
    const { rec } = fakeRecognizer([[{ text: 'too fresh', start: 0.8, end: 0.9, noSpeechProb: 0 }]]);
    const signal = createClientWhisperSignal({
      createCapture: () => cap.capture,
      createRecognizer: () => rec,
      windowSec: 4,
      hopSec: 1,
      settleSec: 0.8,
    });
    const words: string[][] = [];
    await signal.start((tok) => words.push(tok.words));
    cap.push(16000, 0);
    await vi.waitFor(() => expect(rec.transcribe).toHaveBeenCalled());
    await Promise.resolve();
    expect(words).toEqual([]);
    signal.stop();
  });

  it('reports insecure context and never loads a model', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    const load = vi.fn(async () => {});
    const rec: WhisperRecognizer = { load, transcribe: vi.fn(), dispose: vi.fn() };
    const signal = createClientWhisperSignal({ createRecognizer: () => rec, createCapture: () => fakeCapture().capture });
    const errs: string[] = [];
    const onErr: OnError = (e) => errs.push(e.type);
    await signal.start(vi.fn(), onErr);
    expect(errs).toEqual(['insecure-context']);
    expect(load).not.toHaveBeenCalled();
  });

  it('maps a failed model download to model-download-failed', async () => {
    const cap = fakeCapture();
    const rec: WhisperRecognizer = {
      load: async () => {
        throw new DOMException('offline', 'DownloadError');
      },
      transcribe: vi.fn(),
      dispose: vi.fn(),
    };
    const signal = createClientWhisperSignal({ createRecognizer: () => rec, createCapture: () => cap.capture });
    const errs: string[] = [];
    await signal.start(vi.fn(), (e) => errs.push(e.type));
    expect(errs).toEqual(['model-download-failed']);
    expect(rec.dispose).toHaveBeenCalled();
  });

  it('maps a failed model init to model-init-failed', async () => {
    const cap = fakeCapture();
    const rec: WhisperRecognizer = {
      load: async () => {
        throw new DOMException('no webgpu', 'InitError');
      },
      transcribe: vi.fn(),
      dispose: vi.fn(),
    };
    const signal = createClientWhisperSignal({ createRecognizer: () => rec, createCapture: () => cap.capture });
    const errs: string[] = [];
    await signal.start(vi.fn(), (e) => errs.push(e.type));
    expect(errs).toEqual(['model-init-failed']);
  });

  it('forwards model download progress', async () => {
    const cap = fakeCapture();
    const rec = fakeRecognizer(
      [[]],
      async (p) => {
        p?.({ phase: 'downloading', fraction: 0.42 });
      },
    );
    const signal = createClientWhisperSignal({ createRecognizer: () => rec.rec, createCapture: () => cap.capture });
    const progress: SignalProgress[] = [];
    await signal.start(vi.fn(), undefined, (p) => progress.push(p));
    expect(progress.some((p) => p.phase === 'downloading' && p.fraction === 0.42)).toBe(true);
    // start() also fires a synthetic 'ready' once loaded.
    expect(progress.some((p) => p.phase === 'ready')).toBe(true);
    signal.stop();
  });

  it('stop() disposes the recognizer + capture and is idempotent', async () => {
    const cap = fakeCapture();
    const { rec, dispose } = fakeRecognizer([[]]);
    const signal = createClientWhisperSignal({ createRecognizer: () => rec, createCapture: () => cap.capture });
    await signal.start(vi.fn());
    signal.stop();
    signal.stop();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cap.stop).toHaveBeenCalledTimes(1);
  });
});
