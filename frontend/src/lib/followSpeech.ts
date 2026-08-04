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

import type { AdvanceSignal, OnError, OnStage, OnWords, SignalErrorType } from './followSignal';

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
  /** Optional: an engine that ignores it simply returns one alternative. */
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  // Capture-lifecycle events. Optional because an engine may not implement
  // them; assigning to a property the engine ignores is harmless.
  onaudiostart?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onspeechstart?: (() => void) | null;
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
  /** How many transcripts to ask the recognizer for per phrase. See MAX_ALTERNATIVES. */
  maxAlternatives?: number;
}

/**
 * How many candidate transcripts to ask for per phrase.
 *
 * Singing over a guitar is the case this exists for. The recognizer often has the
 * right words somewhere in its candidate list while its top pick is wrong, and we
 * were reading `results[i][0]` only, so everything below first place was thrown
 * away. The tracker scores a recency-weighted presence of unigrams and ordered
 * bigrams, so a candidate that matches no line contributes nothing to any state
 * while a correct one lifts the right line: extra candidates are close to free
 * information for this particular consumer.
 *
 * Five rather than more because the list is ranked and the tail gets noisy fast,
 * and because every extra candidate is another chance to support a wrong line.
 */
const MAX_ALTERNATIVES = 5;

/**
 * How many transient 'network' failures to absorb before treating the session as
 * dead. Chrome's Web Speech API is a network service, so blips are ordinary; an
 * offline session, though, must stop rather than spin.
 */
const NETWORK_RETRY_LIMIT = 3;

export function createSpeechSignal(opts: SpeechSignalOptions = {}): AdvanceSignal {
  const now = opts.now ?? Date.now;
  let rec: SpeechRecognitionLike | null = null;
  let stopped = false;
  // Result indices whose runner-up candidates have already been harvested. Only
  // finalized results are harvested, and a finalized result never changes again,
  // so one pass each is both sufficient and non-repeating.
  const harvested = new Set<number>();
  // Words already emitted from the in-progress utterance (interim results grow).
  let prevWords: string[] = [];
  // Budget for transient 'network' failures before we call it fatal. Reset every
  // time words actually arrive, so a long set with occasional blips keeps going
  // while a genuinely offline session still gives up promptly.
  let networkRetries = 0;

  /** Detach every handler and abort the recognizer. Safe to call repeatedly. */
  const release = () => {
    const r = rec;
    rec = null;
    if (!r) return;
    r.onend = null;
    r.onresult = null;
    r.onerror = null;
    // The capture-ladder handlers too, or a released recognizer can still walk
    // the health stage forward and make a dead session look like it is hearing.
    r.onaudiostart = null;
    r.onsoundstart = null;
    r.onspeechstart = null;
    try {
      r.abort();
    } catch {
      /* noop */
    }
  };

  return {
    start(onWords: OnWords, onError?: OnError, onStage?: OnStage): Promise<void> {
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
      r.maxAlternatives = opts.maxAlternatives ?? MAX_ALTERNATIVES;

      // Capture ladder. On iOS these are the only evidence we get that the mic
      // is actually feeding the recognizer, which is the difference between
      // "your browser never opened the mic" and "it hears you but produces no
      // words" (the known iPad failure with continuous recognition).
      r.onaudiostart = () => {
        if (!stopped) onStage?.('audio');
      };
      r.onsoundstart = () => {
        if (!stopped) onStage?.('sound');
      };
      r.onspeechstart = () => {
        if (!stopped) onStage?.('speech');
      };

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
            // Lowercase so a phrase re-capitalizing when it finalizes ("when the
            // saints" -> "When the Saints") is not seen as new words and
            // re-dumped into the tracker.
            if (word) full.push(word.toLowerCase());
          }
        }
        const tail = wordDelta(prevWords, full);

        // Runner-up candidates, harvested only from finalized results.
        //
        // The delta above is a common-prefix comparison against the top candidate,
        // which needs a stable, append-mostly sequence. Folding other candidates
        // into it would make that prefix thrash and re-emit words already sent.
        // So they travel separately, and only from finalized results: an interim
        // result's candidates are both the least reliable and revised repeatedly,
        // and re-emitting a revision would reinforce a wrong guess every time the
        // recognizer changed its mind.
        const primary = new Set(full);
        const alternates: string[] = [];
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res?.isFinal || harvested.has(i)) continue;
          harvested.add(i);
          for (let a = 1; a < res.length; a++) {
            const transcript = res[a]?.transcript ?? '';
            for (const word of transcript.trim().split(/\s+/)) {
              const w = word.toLowerCase();
              // Words the top candidate already supplied would double-count.
              if (w && !primary.has(w)) alternates.push(w);
            }
          }
        }

        const words = alternates.length > 0 ? [...tail, ...alternates] : tail;
        if (words.length > 0) {
          // Recognition is working, so forgive earlier network blips.
          networkRetries = 0;
          onWords({ words, t: now() });
        }
        prevWords = full;
      };

      r.onerror = (e: SpeechErrorEvent) => {
        if (stopped) return;
        // Silence and self-aborts are transient; onend will restart us.
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        // 'network' is transient too, but only up to a point. Chrome's Web Speech
        // API is a network service, so a blip mid-song is ordinary and used to
        // heal itself via the onend restart. Treating it as fatal would eject a
        // performer from Follow for a hiccup. Retry a bounded number of times so
        // recovery survives without reopening the unbounded start/error/end spin
        // that the fatal path below exists to stop: offline, this gives up after
        // NETWORK_RETRY_LIMIT attempts instead of looping forever.
        if (e.error === 'network' && networkRetries < NETWORK_RETRY_LIMIT) {
          networkRetries += 1;
          return;
        }
        // Anything else is fatal: the recognizer will not recover on its own.
        // Latch the signal off BEFORE reporting, so the onend below does not
        // restart it. iOS Safari refuses the very first start() while the mic
        // permission sheet is up ('not-allowed'), and granting permission does
        // not retroactively start the recognizer, so the restart loop just
        // spins. A spinning recognizer also keeps the iOS audio session
        // captured, which leaves the tuner deaf afterwards. Recovery has to be
        // a fresh start() from a new user gesture.
        stopped = true;
        release();
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
      release();
      prevWords = [];
    },
  };
}
