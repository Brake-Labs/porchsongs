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
  SignalStage,
  SignalTokens,
} from '@/lib/followSignal';
import {
  assessFollowHealth,
  isMatchedEstimate,
  nextHealthDeadline,
  type FollowHealthSnapshot,
  type FollowWarning,
} from '@/lib/followHealth';
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

/** Capture milestones only ever climb, never fall back. */
const STAGE_RANK: Record<SignalStage, number> = { audio: 0, sound: 1, speech: 2 };

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
  /**
   * Highest capture milestone the signal has reported this session, or null if
   * it has reported none. The health check reads this from a ref; it is mirrored
   * into state here purely so the diagnostics HUD can show which rung the mic is
   * stuck on. That distinction is the difference between "your browser never
   * opened the mic", "it is open and hearing silence" and "it hears you but
   * produces no words", and without it the three are indistinguishable from
   * outside. Null on an engine that reports no milestones at all, which is not
   * the same as a failure.
   */
  stage: SignalStage | null;
  /**
   * Why Follow is not working, or null when it looks healthy. Covers both
   * reported errors and the silent failures that have no error at all.
   */
  warning: FollowWarning | null;
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
  const recordingRef = useRef<{
    start: number;
    events: CannedEvent[];
    /** Human repositions: the line the performer said they were on, and when. */
    truth: { at: number; renderIndex: number }[];
  } | null>(null);
  const recentRef = useRef<string[]>([]);
  // Arbiter gating state.
  const ambiguousSinceRef = useRef<number | null>(null);
  const arbiterInFlightRef = useRef(false);
  const lastArbiterAtRef = useRef(-Infinity);
  // Health tracking: what the signal has actually managed to do this session.
  const startedAtRef = useRef<number | null>(null);
  const errorRef = useRef<SignalError | null>(null);
  const stageRef = useRef<SignalStage | null>(null);
  const audioAtRef = useRef<number | null>(null);
  const firstWordsAtRef = useRef<number | null>(null);
  const matchedRef = useRef(false);
  const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evaluateRef = useRef<() => void>(() => {});

  const [estimate, setEstimate] = useState<FollowEstimate | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SignalError | null>(null);
  const [stage, setStage] = useState<SignalStage | null>(null);
  const [warning, setWarning] = useState<FollowWarning | null>(null);
  const [recording, setRecording] = useState(false);
  const [recentWords, setRecentWords] = useState<string[]>([]);
  const [lastArbiter, setLastArbiter] = useState<FollowArbiterEvent | null>(null);

  // Reset when the song changes under us.
  useEffect(() => {
    setEstimate(null);
    setRecentWords([]);
    recentRef.current = [];
  }, [tracker]);

  const clearHealthTimer = useCallback(() => {
    if (healthTimerRef.current != null) {
      clearTimeout(healthTimerRef.current);
      healthTimerRef.current = null;
    }
  }, []);

  /**
   * Recompute the warning and arm one timer for the next moment it could
   * change. Driven by events rather than polling, so a warning shows up when a
   * deadline passes and clears the instant the signal recovers.
   */
  const evaluateHealth = useCallback(() => {
    clearHealthTimer();
    const snapshot: FollowHealthSnapshot = {
      startedAt: startedAtRef.current,
      error: errorRef.current,
      stage: stageRef.current,
      audioAt: audioAtRef.current,
      firstWordsAt: firstWordsAtRef.current,
      matched: matchedRef.current,
      now: nowFn(),
    };
    const next = assessFollowHealth(snapshot);
    setWarning((prev) => (prev?.kind === next?.kind ? prev : next));
    const deadline = nextHealthDeadline(snapshot);
    // Future deadlines only. One already in the past is stable until an event
    // moves the snapshot, and re-arming it would spin.
    if (deadline != null && deadline > snapshot.now) {
      healthTimerRef.current = setTimeout(() => evaluateRef.current(), deadline - snapshot.now);
    }
  }, [clearHealthTimer, nowFn]);
  evaluateRef.current = evaluateHealth;

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
    clearHealthTimer();
    startedAtRef.current = null;
    setWarning(null);
    // A milestone from a session that is over would keep claiming the mic is
    // open, which is the one thing this readout exists to be trusted about.
    setStage(null);
  }, [clearHealthTimer]);

  const start = useCallback(
    async (makeSignal: SignalFactory) => {
      // Tear down any prior signal first (re-start, StrictMode double-invoke).
      signalRef.current?.stop();
      cancelledRef.current = false;
      setError(null);
      errorRef.current = null;

      // Fresh health session: nothing observed yet, clock starts now.
      clearHealthTimer();
      setWarning(null);
      stageRef.current = null;
      setStage(null);
      audioAtRef.current = null;
      firstWordsAtRef.current = null;
      matchedRef.current = false;
      startedAtRef.current = nowFn();

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
        // Words arriving prove the recognizer is alive even if this engine never
        // reported the capture milestones. Only `firstWordsAt` is recorded, not
        // the stage: the assessment short-circuits on `firstWordsAt` before it
        // ever consults `stage`, so there is nothing to promote.
        let healthChanged = false;
        if (words.length > 0) {
          recentRef.current = [...recentRef.current, ...words].slice(-16);
          setRecentWords(recentRef.current);
          if (firstWordsAtRef.current == null) {
            // nowFn, not the signal's `t`: the health clock has to be the same
            // one the deadline timers run on.
            firstWordsAtRef.current = nowFn();
            healthChanged = true;
          }
        }
        if (!matchedRef.current && isMatchedEstimate(est)) {
          matchedRef.current = true;
          healthChanged = true;
        }
        const rec = recordingRef.current;
        if (rec) rec.events.push({ at: t - rec.start, words });
        if (healthChanged) evaluateRef.current();
        maybeConsultArbiter(est, t);
      };
      const onError = (err: SignalError) => {
        if (cancelledRef.current) return;
        errorRef.current = err;
        setError(err);
        setRunning(false);
        // Release the mic. A signal that has reported an error is done; leaving
        // it referenced kept the iOS audio session captured after Follow had
        // visibly given up, which is what left the tuner unable to hear.
        signalRef.current?.stop();
        signalRef.current = null;
        evaluateRef.current();
      };
      const onStage = (stage: SignalStage) => {
        if (cancelledRef.current) return;
        // Milestones only ever climb; a recognizer restart must not walk them back.
        const prev = stageRef.current;
        if (prev != null && STAGE_RANK[stage] <= STAGE_RANK[prev]) return;
        stageRef.current = stage;
        setStage(stage);
        audioAtRef.current ??= nowFn();
        evaluateRef.current();
      };

      try {
        await signal.start(onWords, onError, onStage);
      } catch {
        if (!cancelledRef.current) {
          errorRef.current = { type: 'unsupported' };
          setError(errorRef.current);
          evaluateRef.current();
        }
        return;
      }
      // Stopped while start() was awaiting: discard.
      if (cancelledRef.current) {
        signal.stop();
        return;
      }
      // A signal that reported an error during start() is not running, however
      // eagerly it resolved. An unsupported browser and a denied mic both report
      // synchronously. Saying otherwise is what made a dead Follow look alive:
      // pulsing dot, "Following", no movement.
      if (errorRef.current) return;
      setRunning(true);
      evaluateRef.current();
    },
    [tracker, nowFn, maybeConsultArbiter, clearHealthTimer],
  );

  const reposition = useCallback(
    (stateIndex: number) => {
      const t = nowFn();
      const est = tracker.collapseTo(stateIndex, t);
      setEstimate(est);
      // A human reposition is the one moment we know where the performer really
      // was, which is what makes a recording scorable rather than merely
      // replayable. `FollowRecording.truth` was designed for this and had no
      // producer until tapping a line existed.
      const rec = recordingRef.current;
      if (rec && est.renderIndex != null) {
        rec.truth.push({ at: t - rec.start, renderIndex: est.renderIndex });
      }
    },
    [tracker, nowFn],
  );

  const startRecording = useCallback(() => {
    recordingRef.current = { start: nowFn(), events: [], truth: [] };
    setRecording(true);
  }, [nowFn]);

  const stopRecording = useCallback((): FollowRecording => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    return {
      songText,
      events: rec?.events ?? [],
      // Only present when the performer actually corrected something. An empty
      // array would claim ground truth was collected and happened to be nothing.
      ...(rec?.truth.length ? { truth: rec.truth } : {}),
      recordedAt: new Date(nowFn()).toISOString(),
    };
  }, [songText]);

  // Release the mic/signal on unmount.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      signalRef.current?.stop();
      signalRef.current = null;
      if (healthTimerRef.current != null) clearTimeout(healthTimerRef.current);
      healthTimerRef.current = null;
    };
  }, []);

  return {
    estimate,
    running,
    error,
    stage,
    warning,
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
