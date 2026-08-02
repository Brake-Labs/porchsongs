import { afterEach, beforeEach, vi } from 'vitest';
import { createSpeechSignal, wordDelta } from './followSpeech';
import type { SignalError, SignalTokens } from './followSignal';

// A controllable stand-in for webkitSpeechRecognition. Tests fire its handlers.
class MockRecognition {
  static last: MockRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    MockRecognition.last = this;
  }
}

/** Build a Web-Speech-shaped result event with a single (last) result. */
function resultEvent(transcript: string, isFinal: boolean) {
  const result = Object.assign([{ transcript }], { isFinal, length: 1 });
  return { resultIndex: 0, results: Object.assign([result], { length: 1 }) };
}

/** Build an event whose results list accumulates several finalized phrases. */
function multiResultEvent(segments: [string, boolean][]) {
  const results = segments.map(([transcript, isFinal]) =>
    Object.assign([{ transcript }], { isFinal, length: 1 }),
  );
  return { resultIndex: 0, results: Object.assign(results, { length: results.length }) };
}

const win = window as unknown as Record<string, unknown>;

beforeEach(() => {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  win.SpeechRecognition = MockRecognition;
  MockRecognition.last = null;
});

afterEach(() => {
  delete win.SpeechRecognition;
  delete win.webkitSpeechRecognition;
});

describe('wordDelta', () => {
  it('returns the tail beyond the common prefix', () => {
    expect(wordDelta(['walking'], ['walking', 'down'])).toEqual(['down']);
    expect(wordDelta([], ['a', 'b'])).toEqual(['a', 'b']);
    expect(wordDelta(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('createSpeechSignal', () => {
  it('emits only newly-recognized words as an utterance grows, then resets on final', async () => {
    const got: SignalTokens[] = [];
    const signal = createSpeechSignal({ now: () => 1000 });
    await signal.start((tok) => got.push(tok));
    const rec = MockRecognition.last!;

    rec.onresult!(resultEvent('walking', false));
    rec.onresult!(resultEvent('walking down', false));
    rec.onresult!(resultEvent('walking down the', true));
    rec.onresult!(resultEvent('thinking', false)); // new utterance

    expect(got.map((g) => g.words)).toEqual([['walking'], ['down'], ['the'], ['thinking']]);
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
  });

  it('emits only new words as the results list accumulates (never re-dumps)', async () => {
    const got: SignalTokens[] = [];
    const signal = createSpeechSignal({ now: () => 1000 });
    await signal.start((tok) => got.push(tok));
    const rec = MockRecognition.last!;

    // Phrase 1 finalizes, then phrase 2 grows while phrase 1 stays in the list.
    rec.onresult!(multiResultEvent([['oh when the saints', true]]));
    rec.onresult!(multiResultEvent([['oh when the saints', true], ['go marching', false]]));
    rec.onresult!(multiResultEvent([['oh when the saints', true], ['go marching in', false]]));

    // Each event contributes ONLY its new tail, not the whole transcript again.
    expect(got.map((g) => g.words)).toEqual([
      ['oh', 'when', 'the', 'saints'],
      ['go', 'marching'],
      ['in'],
    ]);
  });

  it('restarts on end while running, but not after stop()', async () => {
    const signal = createSpeechSignal();
    await signal.start(() => {});
    const rec = MockRecognition.last!;
    expect(rec.start).toHaveBeenCalledTimes(1);

    rec.onend!(); // recognizer stopped after a pause
    expect(rec.start).toHaveBeenCalledTimes(2);

    signal.stop();
    expect(rec.abort).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported when the API is missing', async () => {
    delete win.SpeechRecognition;
    let err: SignalError | null = null;
    const signal = createSpeechSignal();
    await signal.start(
      () => {},
      (e) => {
        err = e;
      },
    );
    expect(err).toEqual({ type: 'unsupported' });
  });

  it('reports insecure-context outside HTTPS', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    let err: SignalError | null = null;
    const signal = createSpeechSignal();
    await signal.start(
      () => {},
      (e) => {
        err = e;
      },
    );
    expect(err).toEqual({ type: 'insecure-context' });
  });

  it('maps recognizer errors and ignores transient ones', async () => {
    const errors: SignalError[] = [];
    const signal = createSpeechSignal();
    await signal.start(
      () => {},
      (e) => errors.push(e),
    );
    const rec = MockRecognition.last!;

    rec.onerror!({ error: 'no-speech' }); // transient, ignored
    rec.onerror!({ error: 'not-allowed' }); // permission: fatal, latches off

    expect(errors.map((e) => e.type)).toEqual(['permission-denied']);
  });

  // iOS Safari refuses the first start() while the mic permission sheet is up
  // and reports 'not-allowed'. Restarting from onend cannot help (the grant does
  // not retroactively start the recognizer) and the spin keeps the iOS audio
  // session captured, which is what left the tuner deaf afterwards.
  it('aborts and stops restarting after a fatal error', async () => {
    const errors: SignalError[] = [];
    const signal = createSpeechSignal();
    await signal.start(
      () => {},
      (e) => errors.push(e),
    );
    const rec = MockRecognition.last!;
    expect(rec.start).toHaveBeenCalledTimes(1);

    rec.onerror!({ error: 'not-allowed' });

    // The recognizer is released immediately rather than left holding the mic.
    expect(rec.abort).toHaveBeenCalledTimes(1);
    expect(rec.onend).toBeNull();
    expect(rec.onresult).toBeNull();

    // And nothing restarts it: no second start(), no repeat error report.
    signal.stop();
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
  });

  it('does not emit words after a fatal error', async () => {
    const got: SignalTokens[] = [];
    const signal = createSpeechSignal({ now: () => 1000 });
    await signal.start(
      (tok) => got.push(tok),
      () => {},
    );
    const rec = MockRecognition.last!;
    const onresult = rec.onresult!;

    rec.onerror!({ error: 'not-allowed' });
    onresult(resultEvent('walking', false));

    expect(got).toEqual([]);
  });
});
