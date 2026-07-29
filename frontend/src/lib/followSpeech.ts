/**
 * SpeechSignal: an AdvanceSignal backed by the browser Web Speech API
 * (webkitSpeechRecognition). This is the fast, no-dependency path for validating
 * Follow mode against real singing on desktop Chrome. It is online and routes
 * audio through the browser's recognizer (a third party), so it is a validation
 * provider, not the private on-device default.
 *
 * It emits only newly-recognized words (the growing/correcting tail of the
 * current utterance), on the same clock the tracker consumes, and keeps itself
 * alive across the recognizer's habit of stopping after pauses.
 */

import type { AdvanceSignal, OnError, OnWords, SignalErrorType } from './followSignal';

// Minimal Web Speech typings (not part of the standard DOM lib).
interface SpeechAlternative {
  readonly transcript: string;
}
interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  readonly [index: number]: SpeechResult;
}
interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}
interface SpeechErrorEvent {
  readonly error: string;
  readonly message?: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function mapError(code: string): SignalErrorType {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permission-denied';
    case 'audio-capture':
      return 'not-found';
    case 'network':
      return 'network';
    default:
      return 'aborted';
  }
}

/** New words in `curr` beyond the common prefix it shares with `prev`. */
export function wordDelta(prev: string[], curr: string[]): string[] {
  let i = 0;
  while (i < prev.length && i < curr.length && prev[i] === curr[i]) i++;
  return curr.slice(i);
}

export interface SpeechSignalOptions {
  lang?: string;
  /** Clock for emission timestamps (default Date.now). */
  now?: () => number;
}

export function createSpeechSignal(opts: SpeechSignalOptions = {}): AdvanceSignal {
  const now = opts.now ?? Date.now;
  let rec: SpeechRecognitionLike | null = null;
  let stopped = false;
  // Words already emitted from the in-progress utterance (interim results grow).
  let prevWords: string[] = [];

  return {
    start(onWords: OnWords, onError?: OnError): Promise<void> {
      stopped = false;
      if (!window.isSecureContext) {
        onError?.({ type: 'insecure-context' });
        return Promise.resolve();
      }
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        onError?.({ type: 'unsupported' });
        return Promise.resolve();
      }

      const r = new Ctor();
      rec = r;
      r.continuous = true;
      r.interimResults = true;
      r.lang = opts.lang ?? 'en-US';

      r.onresult = (e: SpeechResultEvent) => {
        if (stopped) return;
        // In continuous mode `e.results` accumulates every phrase this session.
        // Concatenate them all into the full transcript and emit only the new
        // tail vs what we've already sent. Never reset per-result, so we never
        // re-dump the whole accumulated transcript into the tracker (which would
        // flood the rolling window with every line of the song at once).
        const full: string[] = [];
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          const transcript = res?.[0]?.transcript ?? '';
          for (const word of transcript.trim().split(/\s+/)) {
            if (word) full.push(word);
          }
        }
        const tail = wordDelta(prevWords, full);
        if (tail.length > 0) onWords({ words: tail, t: now() });
        prevWords = full;
      };

      r.onerror = (e: SpeechErrorEvent) => {
        if (stopped) return;
        // Silence and self-aborts are transient; onend will restart us.
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        onError?.({ type: mapError(e.error), message: e.message });
      };

      r.onend = () => {
        // Do NOT clear prevWords here: Chrome keeps the accumulated results list
        // across this internal restart, so clearing it would re-emit the entire
        // transcript as "new" and flood the tracker. Keep dedup state.
        // The recognizer stops after pauses; keep listening until WE stop it.
        if (!stopped) {
          try {
            r.start();
          } catch {
            /* already starting; ignore the race */
          }
        }
      };

      try {
        r.start();
      } catch {
        onError?.({ type: 'aborted' });
      }
      return Promise.resolve();
    },

    stop(): void {
      stopped = true;
      if (rec) {
        rec.onend = null;
        rec.onresult = null;
        rec.onerror = null;
        try {
          rec.abort();
        } catch {
          /* noop */
        }
        rec = null;
      }
      prevWords = [];
    },
  };
}
