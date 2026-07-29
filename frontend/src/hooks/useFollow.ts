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

export interface UseFollowOptions {
  config?: Partial<FollowConfig>;
  /** Clock for reposition/recording timestamps (default Date.now). Injectable for tests. */
  now?: () => number;
}

export interface UseFollowResult {
  /** Current estimate, or null before the signal has started. */
  estimate: FollowEstimate | null;
  running: boolean;
  error: SignalError | null;
  recording: boolean;
  /** Most-recent recognized words (for the debug overlay). */
  recentWords: string[];
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
 * AdvanceSignal, and exposes the live estimate plus a record-to-JSON capture.
 * The tracker is the single source of line-mapping truth; this hook just feeds
 * it recognized words and surfaces state. Rebuilds the tracker when the song
 * text changes (version toggle, edit).
 */
export function useFollow(songText: string, opts: UseFollowOptions = {}): UseFollowResult {
  const nowFn = opts.now ?? Date.now;
  const configRef = useRef(opts.config);
  configRef.current = opts.config;

  const tracker = useMemo(
    () => createFollowTracker(songText, configRef.current),
    [songText],
  );

  const signalRef = useRef<AdvanceSignal | null>(null);
  const cancelledRef = useRef(false);
  const recordingRef = useRef<{ start: number; events: CannedEvent[] } | null>(null);

  const [estimate, setEstimate] = useState<FollowEstimate | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<SignalError | null>(null);
  const [recording, setRecording] = useState(false);
  const [recentWords, setRecentWords] = useState<string[]>([]);

  // Reset when the song changes under us.
  useEffect(() => {
    setEstimate(null);
    setRecentWords([]);
  }, [tracker]);

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

      const signal = makeSignal();
      signalRef.current = signal;

      const onWords = ({ words, t }: SignalTokens) => {
        if (cancelledRef.current) return;
        setEstimate(tracker.observe(words, t));
        if (words.length > 0) setRecentWords((prev) => [...prev, ...words].slice(-16));
        const rec = recordingRef.current;
        if (rec) rec.events.push({ at: t - rec.start, words });
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
    [tracker, nowFn],
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
    start,
    stop,
    reposition,
    startRecording,
    stopRecording,
  };
}
