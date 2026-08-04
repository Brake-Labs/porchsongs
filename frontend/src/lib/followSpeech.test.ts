import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeechSignal, wordDelta } from './followSpeech';
import type { SignalError, SignalStage, SignalTokens } from './followSignal';

// A controllable stand-in for webkitSpeechRecognition. Tests fire its handlers.
class MockRecognition {
  static last: MockRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = '';
  // Set by createSpeechSignal; a real engine that ignores it returns one candidate.
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onsoundstart: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
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

  it('reports the capture ladder so silent failures can be told apart', async () => {
    const stages: SignalStage[] = [];
    const signal = createSpeechSignal();
    await signal.start(
      () => {},
      undefined,
      (s) => stages.push(s),
    );
    const rec = MockRecognition.last!;

    rec.onaudiostart!();
    rec.onsoundstart!();
    rec.onspeechstart!();

    expect(stages).toEqual(['audio', 'sound', 'speech']);
  });

  it('stops reporting stages after stop()', async () => {
    const stages: SignalStage[] = [];
    const signal = createSpeechSignal();
    await signal.start(
      () => {},
      undefined,
      (s) => stages.push(s),
    );
    const rec = MockRecognition.last!;
    signal.stop();

    expect(rec.onaudiostart).toBeNull();
    expect(rec.onsoundstart).toBeNull();
    expect(rec.onspeechstart).toBeNull();
    expect(stages).toEqual([]);
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

describe('transient network failures', () => {
  it('recovers from a network blip instead of ending the session', async () => {
    // Chrome's Web Speech API is a network service, so a blip mid-song is
    // ordinary and used to heal itself via the onend restart. Treating it as
    // fatal would eject a performer from Follow for a hiccup.
    const errors: SignalError[] = [];
    const signal = createSpeechSignal();
    await signal.start(() => {}, e => errors.push(e));
    const rec = MockRecognition.last!;

    rec.onerror!({ error: 'network' });

    expect(errors).toEqual([]);
    rec.onend!();
    // Still alive: the restart went through rather than being latched off.
    expect(rec.start).toHaveBeenCalledTimes(2);
  });

  it('gives up once the retry budget is spent', async () => {
    // The bound is what stops an offline session from reopening the unbounded
    // start/error/end spin that the fatal path exists to prevent.
    const errors: SignalError[] = [];
    const signal = createSpeechSignal();
    await signal.start(() => {}, e => errors.push(e));
    const rec = MockRecognition.last!;

    for (let i = 0; i < 4; i++) rec.onerror!({ error: 'network' });

    expect(errors.map(e => e.type)).toEqual(['network']);
    // Latched off and released: handlers detached, so onend cannot restart it.
    expect(rec.onend).toBeNull();
    expect(rec.abort).toHaveBeenCalled();
    expect(rec.start).toHaveBeenCalledTimes(1);
  });

  it('forgives earlier blips once words come through', async () => {
    const errors: SignalError[] = [];
    const words: SignalTokens[] = [];
    const signal = createSpeechSignal({ now: () => 0 });
    await signal.start(w => words.push(w), e => errors.push(e));
    const rec = MockRecognition.last!;

    rec.onerror!({ error: 'network' });
    rec.onerror!({ error: 'network' });
    rec.onerror!({ error: 'network' });
    rec.onresult!(resultEvent('amazing grace', true));
    // Budget reset, so a long set with occasional blips keeps going.
    rec.onerror!({ error: 'network' });

    expect(words).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('still treats a denied mic as immediately fatal', async () => {
    // The retry budget must not soften the case the fix was written for.
    const errors: SignalError[] = [];
    const signal = createSpeechSignal();
    await signal.start(() => {}, e => errors.push(e));
    const rec = MockRecognition.last!;

    rec.onerror!({ error: 'not-allowed' });

    expect(errors.map(e => e.type)).toEqual(['permission-denied']);
    expect(rec.onend).toBeNull();
    expect(rec.start).toHaveBeenCalledTimes(1);
  });
});

/** Build an event whose results each carry several ranked candidates. */
function altResultEvent(segments: { alts: string[]; isFinal: boolean }[]) {
  const results = segments.map(({ alts, isFinal }) =>
    Object.assign(
      alts.map((transcript) => ({ transcript })),
      { isFinal, length: alts.length },
    ),
  );
  return { resultIndex: 0, results: Object.assign(results, { length: results.length }) };
}

/**
 * Runner-up candidates.
 *
 * Singing over a guitar, the recognizer often has the right words somewhere in its
 * candidate list while its top pick is wrong. Only `results[i][0]` was ever read,
 * so everything below first place was discarded. The tracker scores presence of
 * unigrams and bigrams, so a candidate matching no line costs nothing while a
 * correct one lifts the right line.
 */
describe('createSpeechSignal alternatives', () => {
  async function startWith(opts: Parameters<typeof createSpeechSignal>[0] = {}) {
    const words: SignalTokens[] = [];
    const signal = createSpeechSignal({ now: () => 1000, ...opts });
    await signal.start((tok) => words.push(tok));
    return { words, rec: MockRecognition.last!, signal };
  }

  it('asks the recognizer for several candidates', async () => {
    const { rec } = await startWith();
    expect(rec.maxAlternatives).toBeGreaterThan(1);
  });

  it('honours an explicit candidate count', async () => {
    const { rec } = await startWith({ maxAlternatives: 2 });
    expect(rec.maxAlternatives).toBe(2);
  });

  it('emits words from runner-up candidates of a finalized phrase', async () => {
    const { words, rec } = await startWith();
    rec.onresult!(altResultEvent([{ alts: ['wander down the road', 'walking down the road'], isFinal: true }]));
    // The top candidate mishears "walking" as "wander"; the correct word is in
    // second place and used to be thrown away.
    expect(words.flatMap((w) => w.words)).toContain('walking');
  });

  it('does not repeat words the top candidate already supplied', async () => {
    const { words, rec } = await startWith();
    rec.onresult!(altResultEvent([{ alts: ['down the road', 'down the road'], isFinal: true }]));
    const emitted = words.flatMap((w) => w.words);
    // "down" once, not twice: double-counting would over-weight the line.
    expect(emitted.filter((w) => w === 'down')).toHaveLength(1);
  });

  it('ignores candidates on an interim phrase', async () => {
    // Interim candidates are the least reliable and get revised repeatedly, so
    // harvesting them would reinforce a wrong guess on every revision.
    const { words, rec } = await startWith();
    rec.onresult!(altResultEvent([{ alts: ['wander', 'walking'], isFinal: false }]));
    expect(words.flatMap((w) => w.words)).not.toContain('walking');
  });

  it('harvests a phrase only once, however often the event refires', async () => {
    const { words, rec } = await startWith();
    const event = altResultEvent([{ alts: ['wander down', 'walking down'], isFinal: true }]);
    rec.onresult!(event);
    rec.onresult!(event);
    rec.onresult!(event);
    expect(words.flatMap((w) => w.words).filter((w) => w === 'walking')).toHaveLength(1);
  });

  it('still emits the top candidate when there are no runner-ups', async () => {
    const { words, rec } = await startWith();
    rec.onresult!(altResultEvent([{ alts: ['walking down the road'], isFinal: true }]));
    expect(words.flatMap((w) => w.words)).toEqual(['walking', 'down', 'the', 'road']);
  });

  it('lowercases candidate words like the primary transcript', async () => {
    const { words, rec } = await startWith();
    rec.onresult!(altResultEvent([{ alts: ['wander', 'Walking Down'], isFinal: true }]));
    const emitted = words.flatMap((w) => w.words);
    expect(emitted).toContain('walking');
    expect(emitted).not.toContain('Walking');
  });
});
