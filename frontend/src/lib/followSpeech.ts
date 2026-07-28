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
        const last = e.results[e.results.length - 1];
        if (!last) return;
        const words = (last[0]?.transcript ?? '').trim().split(/\s+/).filter(Boolean);
        const tail = wordDelta(prevWords, words);
        if (tail.length > 0) onWords({ words: tail, t: now() });
        // On a final result the next utterance starts fresh.
        prevWords = last.isFinal ? [] : words;
      };

      r.onerror = (e: SpeechErrorEvent) => {
        if (stopped) return;
        // Silence and self-aborts are transient; onend will restart us.
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        onError?.({ type: mapError(e.error), message: e.message });
      };

      r.onend = () => {
        prevWords = [];
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
