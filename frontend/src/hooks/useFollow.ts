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
  SignalTokens,
} from '@/lib/followSignal';
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

export interface UseFollowOptions {
  config?: Partial<FollowConfig>;
  /** Clock for reposition/recording timestamps (default Date.now). Injectable for tests. */
  now?: () => number;
  arbiter?: FollowArbiterConfig;
}

export interface UseFollowResult {
  /** Current estimate, or null before the signal has started. */
  estimate: FollowEstimate | null;
  running: boolean;
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
  /** Stop recording and return the captured session (song + timed events). */
  stopRecording: () => FollowRecording;
}

/**
 * Runtime glue for Follow mode: owns the position tracker, drives it from an
 * AdvanceSignal, exposes the live estimate + a record-to-JSON capture, and
 * consults the gated LLM arbiter when the tracker is sustained-ambiguous.
 */
export function useFollow(songText: string, opts: UseFollowOptions = {}): UseFollowResult {
  const nowFn = opts.now ?? Date.now;
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
  // Arbiter gating state.
  const ambiguousSinceRef = useRef<number | null>(null);
  const arbiterInFlightRef = useRef(false);
  const lastArbiterAtRef = useRef(-Infinity);

  const [estimate, setEstimate] = useState<FollowEstimate | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SignalError | null>(null);
  const [recording, setRecording] = useState(false);
  const [recentWords, setRecentWords] = useState<string[]>([]);
  const [lastArbiter, setLastArbiter] = useState<FollowArbiterEvent | null>(null);

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
    setRunning(false);
  }, []);

  const start = useCallback(
    async (makeSignal: SignalFactory) => {
      // Tear down any prior signal first (re-start, StrictMode double-invoke).
      signalRef.current?.stop();
      cancelledRef.current = false;
      setError(null);

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
        }
        const rec = recordingRef.current;
        if (rec) rec.events.push({ at: t - rec.start, words });
        maybeConsultArbiter(est, t);
      };
      const onError = (err: SignalError) => {
        if (cancelledRef.current) return;
        setError(err);
        setRunning(false);
      };

      try {
        await signal.start(onWords, onError);
      } catch {
        if (!cancelledRef.current) setError({ type: 'unsupported' });
        return;
      }
      // Stopped while start() was awaiting: discard.
      if (cancelledRef.current) {
        signal.stop();
        return;
      }
      setRunning(true);
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
    setRecording(true);
  }, [nowFn]);

  const stopRecording = useCallback((): FollowRecording => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    return { songText, events: rec?.events ?? [] };
  }, [songText]);

  // Release the mic/signal on unmount.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      signalRef.current?.stop();
      signalRef.current = null;
    };
  }, []);

  return {
    estimate,
    running,
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
