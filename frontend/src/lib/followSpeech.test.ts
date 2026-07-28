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
    rec.onerror!({ error: 'not-allowed' }); // permission
    rec.onerror!({ error: 'audio-capture' }); // no device

    expect(errors.map((e) => e.type)).toEqual(['permission-denied', 'not-found']);
  });
});
