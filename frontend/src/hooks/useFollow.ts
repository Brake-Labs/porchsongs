import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createFollowTracker,
  type FollowConfig,
  type FollowEstimate,
} from '@/lib/followAlign';
import type {
  AdvanceSignal,
  CannedEvent,
  FollowRecording,
  SignalError,
  SignalFactory,
  SignalProgress,
  SignalTokens,
} from '@/lib/followSignal';
import {
  createAudioCapture,
  encodeWav,
  TARGET_SAMPLE_RATE,
  type AudioCapture,
  type AudioCaptureFactory,
} from '@/lib/followAudioCapture';
import { requestDisambiguation, type ArbiterRequest } from '@/lib/followArbiter';

/** Configuration for the gated LLM arbiter. Omit (or enabled:false) to disable. */
export interface FollowArbiterConfig {
  enabled: boolean;
  /** LLM model to use for the arbiter call (from the app's model setting). */
  model: string;
  /** Injectable request fn for tests; defaults to the real backend call. */
  request?: (req: ArbiterRequest) => Promise<number | null>;
  /** Sustained ambiguity (ms) before consulting the arbiter (default 1200). */
  ambiguousMs?: number;
  /** Minimum ms between arbiter calls (default 3000). */
  cooldownMs?: number;
}

export interface FollowArbiterEvent {
  at: number;
  choice: number | null;
  candidates: number[];
}

/**
 * Follow lifecycle. Web Speech and the canned signal jump straight to
 * listening/tracking; the on-device recognizer passes through preparing ->
 * downloading -> ready first, which is why `running: boolean` was not enough to
 * describe the UI (a silent model download would otherwise render as
 * "Following"). The tracker never sees this — it is pure UI state.
 */
export type FollowPhase =
  | 'idle'
  | 'preparing'
  | 'downloading'
  | 'ready'
  | 'listening'
  | 'tracking'
  | 'error';

export interface UseFollowOptions {
  config?: Partial<FollowConfig>;
  /** Clock for reposition/recording timestamps (default Date.now). Injectable for tests. */
  now?: () => number;
  arbiter?: FollowArbiterConfig;
  /** Audio capture factory for the debug recorder (injectable for tests). */
  createAudioCapture?: AudioCaptureFactory;
}

/** Result of a debug recording: the token stream plus the captured audio (if any). */
export interface FollowRecordingResult {
  recording: FollowRecording;
  audio: Blob | null;
}

export interface UseFollowResult {
  /** Current estimate, or null before the signal has started. */
  estimate: FollowEstimate | null;
  /** True once the mic is live (listening or tracking). Derived from `phase`. */
  running: boolean;
  /** Full lifecycle state, including the on-device model prepare/download phases. */
  phase: FollowPhase;
  /** Model download/init progress while `phase` is preparing/downloading. */
  progress: SignalProgress | null;
  error: SignalError | null;
  recording: boolean;
  /** Most-recent recognized words (for the debug overlay). */
  recentWords: string[];
  /** The last LLM-arbiter consultation (for the debug overlay), or null. */
  lastArbiter: FollowArbiterEvent | null;
  /** Begin listening via the given signal. */
  start: (makeSignal: SignalFactory) => Promise<void>;
  stop: () => void;
  /** Human reposition: collapse the tracker onto a lyric-line state. */
  reposition: (stateIndex: number) => void;
  startRecording: () => void;
  /** Stop recording; returns the captured session (tokens) plus a WAV blob if audio was captured. */
  stopRecording: () => FollowRecordingResult;
}

/**
 * Runtime glue for Follow mode: owns the position tracker, drives it from an
 * AdvanceSignal, exposes the live estimate + a record-to-JSON+WAV capture, and
 * consults the gated LLM arbiter when the tracker is sustained-ambiguous.
 */
export function useFollow(songText: string, opts: UseFollowOptions = {}): UseFollowResult {
  const nowFn = opts.now ?? Date.now;
  const makeCapture = opts.createAudioCapture ?? createAudioCapture;
  const configRef = useRef(opts.config);
  configRef.current = opts.config;
  const arbiterRef = useRef(opts.arbiter);
  arbiterRef.current = opts.arbiter;

  const tracker = useMemo(
    () => createFollowTracker(songText, configRef.current),
    [songText],
  );
  const songLines = useMemo(() => songText.split('\n'), [songText]);

  const signalRef = useRef<AdvanceSignal | null>(null);
  const cancelledRef = useRef(false);
  const recordingRef = useRef<{ start: number; events: CannedEvent[] } | null>(null);
  const recentRef = useRef<string[]>([]);
  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  // Arbiter gating state.
  const ambiguousSinceRef = useRef<number | null>(null);
  const arbiterInFlightRef = useRef(false);
  const lastArbiterAtRef = useRef(-Infinity);

  const [estimate, setEstimate] = useState<FollowEstimate | null>(null);
  const [phase, setPhase] = useState<FollowPhase>('idle');
  const [progress, setProgress] = useState<SignalProgress | null>(null);
  const [error, setError] = useState<SignalError | null>(null);
  const [recording, setRecording] = useState(false);
  const [recentWords, setRecentWords] = useState<string[]>([]);
  const [lastArbiter, setLastArbiter] = useState<FollowArbiterEvent | null>(null);

  const running = phase === 'listening' || phase === 'tracking';

  // Reset when the song changes under us.
  useEffect(() => {
    setEstimate(null);
    setRecentWords([]);
    recentRef.current = [];
  }, [tracker]);

  /** A few lines of lyric context around a rendered line, for the arbiter prompt. */
  const contextFor = useCallback(
    (renderIndex: number) => songLines.slice(renderIndex, renderIndex + 3).join('\n').trim(),
    [songLines],
  );

  /** Consult the arbiter when ambiguity has persisted, rate-limited and non-blocking. */
  const maybeConsultArbiter = useCallback(
    (est: FollowEstimate, t: number) => {
      const arb = arbiterRef.current;
      if (!arb?.enabled || !arb.model || est.stateIndex == null) {
        ambiguousSinceRef.current = null;
        return;
      }
      if (!est.ambiguous) {
        ambiguousSinceRef.current = null;
        return;
      }
      if (ambiguousSinceRef.current == null) {
        ambiguousSinceRef.current = t;
        return;
      }
      if (t - ambiguousSinceRef.current < (arb.ambiguousMs ?? 1200)) return;
      if (arbiterInFlightRef.current) return;
      if (t - lastArbiterAtRef.current < (arb.cooldownMs ?? 3000)) return;

      const candidates = est.top.map((c) => ({
        stateIndex: c.stateIndex,
        context: contextFor(c.renderIndex),
      }));
      arbiterInFlightRef.current = true;
      lastArbiterAtRef.current = t;
      const send = arb.request ?? ((r: ArbiterRequest) => requestDisambiguation(r));
      send({
        recentWords: recentRef.current.join(' '),
        candidates,
        currentStateIndex: est.stateIndex,
        model: arb.model,
      })
        .then((choice) => {
          arbiterInFlightRef.current = false;
          if (cancelledRef.current) return;
          setLastArbiter({ at: t, choice, candidates: candidates.map((c) => c.stateIndex) });
          if (choice != null) setEstimate(tracker.nudge(choice, nowFn()));
        })
        .catch(() => {
          arbiterInFlightRef.current = false;
        });
    },
    [contextFor, tracker, nowFn],
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
    signalRef.current?.stop();
    signalRef.current = null;
    setPhase('idle');
    setProgress(null);
  }, []);

  const start = useCallback(
    async (makeSignal: SignalFactory) => {
      // Tear down any prior signal first (re-start, StrictMode double-invoke).
      signalRef.current?.stop();
      cancelledRef.current = false;
      setError(null);
      setProgress(null);
      setPhase('preparing');

      // Fresh session: clear the rolling window and seed a strong "starting at
      // the top" prior, so each Follow starts at line 0 instead of a uniform
      // belief that can lock onto a repeated verse immediately.
      tracker.reset();
      setEstimate(tracker.collapseTo(0, nowFn()));
      setRecentWords([]);
      recentRef.current = [];
      ambiguousSinceRef.current = null;
      arbiterInFlightRef.current = false;
      lastArbiterAtRef.current = -Infinity;
      setLastArbiter(null);

      const signal = makeSignal();
      signalRef.current = signal;

      const onWords = ({ words, t }: SignalTokens) => {
        if (cancelledRef.current) return;
        const est = tracker.observe(words, t);
        setEstimate(est);
        if (words.length > 0) {
          recentRef.current = [...recentRef.current, ...words].slice(-16);
          setRecentWords(recentRef.current);
          setPhase('tracking');
        }
        const rec = recordingRef.current;
        if (rec) rec.events.push({ at: t - rec.start, words });
        maybeConsultArbiter(est, t);
      };
      const onError = (err: SignalError) => {
        if (cancelledRef.current) return;
        setError(err);
        setPhase('error');
      };
      const onProgress = (p: SignalProgress) => {
        if (cancelledRef.current) return;
        setProgress(p);
        if (p.phase === 'downloading') setPhase('downloading');
        else if (p.phase === 'initializing') setPhase('preparing');
        else if (p.phase === 'ready') setPhase('ready');
      };

      try {
        await signal.start(onWords, onError, onProgress);
      } catch {
        if (!cancelledRef.current) {
          setError({ type: 'unsupported' });
          setPhase('error');
        }
        return;
      }
      // Stopped while start() was awaiting: discard.
      if (cancelledRef.current) {
        signal.stop();
        return;
      }
      // start() resolved without an error: mic is live. Stay 'listening' until
      // the first words arrive (onWords flips us to 'tracking').
      setPhase((prev) => (prev === 'error' || prev === 'tracking' ? prev : 'listening'));
    },
    [tracker, nowFn, maybeConsultArbiter],
  );

  const reposition = useCallback(
    (stateIndex: number) => {
      setEstimate(tracker.collapseTo(stateIndex, nowFn()));
    },
    [tracker, nowFn],
  );

  const startRecording = useCallback(() => {
    recordingRef.current = { start: nowFn(), events: [] };
    audioChunksRef.current = [];
    setRecording(true);
    // Best-effort audio capture alongside the tokens, so the same sung signal
    // can be replayed through an offline recognizer. Independent of which
    // signal is running; if the mic is unavailable, recording proceeds
    // token-only.
    const cap = makeCapture({ now: nowFn });
    audioCaptureRef.current = cap;
    cap
      .start((frame) => {
        audioChunksRef.current.push(frame);
      })
      .catch(() => {
        audioCaptureRef.current = null;
      });
  }, [nowFn, makeCapture]);

  const stopRecording = useCallback((): FollowRecordingResult => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);

    audioCaptureRef.current?.stop();
    audioCaptureRef.current = null;
    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];

    let audio: Blob | null = null;
    let audioSampleRate: number | undefined;
    let audioFile: string | undefined;
    if (chunks.length > 0) {
      let total = 0;
      for (const c of chunks) total += c.length;
      const pcm = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        pcm.set(c, offset);
        offset += c.length;
      }
      if (pcm.length > 0) {
        audio = encodeWav(pcm, TARGET_SAMPLE_RATE);
        audioSampleRate = TARGET_SAMPLE_RATE;
        audioFile = 'follow-recording.wav';
      }
    }

    const recording: FollowRecording = {
      songText,
      events: rec?.events ?? [],
      ...(audioSampleRate ? { audioSampleRate, audioFile } : {}),
    };
    return { recording, audio };
  }, [songText]);

  // Release the mic/signal on unmount.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      signalRef.current?.stop();
      signalRef.current = null;
      audioCaptureRef.current?.stop();
      audioCaptureRef.current = null;
    };
  }, []);

  return {
    estimate,
    running,
    phase,
    progress,
    error,
    recording,
    recentWords,
    lastArbiter,
    start,
    stop,
    reposition,
    startRecording,
    stopRecording,
  };
}
