/**
 * The "advance signal" seam for Follow mode.
 *
 * A signal is anything that produces recognized WORDS over time: a scripted
 * fixture (CannedSignal), the browser Web Speech API (SpeechSignal, added later),
 * or an on-device model. It emits tokens only. It does NOT know about lyric lines
 * or scrolling. Turning words into a line position is followAlign's job, so every
 * signal implementation shares one aligner and stays trivially swappable.
 *
 *   signal.start(onWords, onError)  ->  onWords({ words, t }) over time
 *
 * `t` is the emit time in ms on the same clock the tracker is fed with, so
 * followAlign's rolling window and staleness math line up regardless of source.
 */

import { normalizeSong, type FollowEstimate, type FollowTracker } from './followAlign';

export interface SignalTokens {
  /** Newly recognized words (raw; the aligner normalizes them). */
  words: string[];
  /** Emit time in ms (same clock the tracker's `observe(words, now)` uses). */
  t: number;
}

/** Error taxonomy shared with the real (mic) signals; mirrors useTuner. */
export type SignalErrorType =
  | 'permission-denied'
  | 'not-found'
  | 'unsupported'
  | 'insecure-context'
  | 'aborted'
  | 'network'
  // On-device recognizer (whisper) lifecycle. Kept distinct from `unsupported`
  // so a transient model-fetch blip does not tell a supported browser the
  // feature does not exist.
  | 'model-download-failed'
  | 'model-init-failed';

export interface SignalError {
  type: SignalErrorType;
  message?: string;
}

/**
 * Preparation progress for signals that must load before they can listen (the
 * on-device recognizer downloads and initializes a model). Web Speech and the
 * canned signal never emit this. Reported through `start`'s optional
 * `onProgress` so the seam can drive a "downloading 40%" UI without the tracker
 * ever learning that models exist.
 */
export interface SignalProgress {
  phase: 'downloading' | 'initializing' | 'ready';
  /** 0..1 when known (download only); undefined while indeterminate. */
  fraction?: number;
  loaded?: number;
  total?: number;
}

export type OnWords = (tokens: SignalTokens) => void;
export type OnError = (err: SignalError) => void;
export type OnProgress = (progress: SignalProgress) => void;

export interface AdvanceSignal {
  /**
   * Begin emitting words. Resolves once started (permission granted, model
   * loaded, etc.). `onProgress` is optional and only fires for signals with a
   * load phase; instant signals resolve without ever calling it.
   */
  start(onWords: OnWords, onError?: OnError, onProgress?: OnProgress): Promise<void>;
  /** Stop emitting and release any resources. Safe to call more than once. */
  stop(): void;
}

export type SignalFactory = () => AdvanceSignal;

/** One scripted emission: `words` delivered `at` ms after the signal starts. */
export interface CannedEvent {
  at: number;
  words: string[];
}

/** A recorded or scripted session: ordered emissions plus the source song text. */
export interface FollowRecording {
  songText: string;
  events: CannedEvent[];
  /** Optional ground-truth taps: the line the performer said they were on. */
  truth?: { at: number; renderIndex: number }[];
  recordedAt?: string;
  provider?: string;
  /**
   * Sample rate of the companion WAV, when audio was captured alongside the
   * tokens. The audio itself downloads as a separate .wav so the same sung
   * signal can be replayed through an offline recognizer to measure feasibility.
   */
  audioSampleRate?: number;
  audioFile?: string;
}

export interface CannedOptions {
  /** Clock for emission timestamps (default Date.now). */
  now?: () => number;
}

/**
 * A signal that replays a scripted token stream on real timers. Used by the
 * debug overlay and for manual dogfooding without a mic. Idempotent stop.
 */
export function createCannedSignal(
  events: CannedEvent[],
  opts: CannedOptions = {},
): AdvanceSignal {
  const now = opts.now ?? (() => Date.now());
  let timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;

  return {
    start(onWords: OnWords): Promise<void> {
      stopped = false;
      for (const ev of events) {
        const handle = setTimeout(() => {
          if (!stopped) onWords({ words: ev.words, t: now() });
        }, ev.at);
        timers.push(handle);
      }
      return Promise.resolve();
    },
    stop(): void {
      stopped = true;
      for (const h of timers) clearTimeout(h);
      timers = [];
    },
  };
}

/**
 * Build a scripted "someone sings this exact song, top to bottom" token stream
 * from a song's own lyrics. Lets the debug overlay demo Follow on any real song
 * with no microphone: pipe it through createCannedSignal or replayScript.
 */
export function scriptFromSong(songText: string, gapMs = 2500, startAt = 0): CannedEvent[] {
  const song = normalizeSong(songText);
  return song.lyricStates.map((state, i) => ({
    at: startAt + i * gapMs,
    words: state.tokens,
  }));
}

export interface ReplayStep {
  event: CannedEvent;
  estimate: FollowEstimate;
}

/**
 * Synchronously feed a scripted session into a tracker, deterministically (no
 * timers). Each event is observed at its own `at` time. This is both the pure
 * integration test for the whole loop and the offline threshold-tuning harness:
 * a recorded session replays here identically to how it ran live.
 */
export function replayScript(tracker: FollowTracker, events: CannedEvent[]): ReplayStep[] {
  return events.map((event) => ({
    event,
    estimate: tracker.observe(event.words, event.at),
  }));
}
