import { afterEach, vi } from 'vitest';
import { createFollowTracker, normalizeLyricTokens } from './followAlign';
import {
  createCannedSignal,
  replayScript,
  scriptFromSong,
  type CannedEvent,
  type SignalTokens,
} from './followSignal';

const SONG = [
  '[Verse 1]',
  'C            G',
  'walking down the empty road',
  'Am           F',
  'thinking of the words you said',
  '',
  '[Chorus]',
  'C        G',
  'hold me now under the northern light',
  'F        C',
  'never let me go into the night',
  '',
  '[Verse 2]',
  'C            G',
  'morning breaks and you are gone away',
  'Am           F',
  'still i sing this very lonely song',
  '',
  '[Chorus]',
  'C        G',
  'hold me now under the northern light',
  'F        C',
  'never let me go into the night',
].join('\n');

const w = normalizeLyricTokens;
// A performer singing the song straight through, ~2s per line.
const STRAIGHT_THROUGH: CannedEvent[] = [
  { at: 0, words: w('walking down the empty road') },
  { at: 2000, words: w('thinking of the words you said') },
  { at: 4000, words: w('hold me now under the northern light') },
  { at: 6000, words: w('never let me go into the night') },
  { at: 8000, words: w('morning breaks and you are gone away') },
  { at: 10000, words: w('still i sing this very lonely song') },
  { at: 12000, words: w('hold me now under the northern light') },
  { at: 14000, words: w('never let me go into the night') },
];

describe('replayScript — whole loop, deterministic', () => {
  it('tracks a straight-through performance line by line, resolving the 2nd chorus ahead', () => {
    const tracker = createFollowTracker(SONG);
    const steps = replayScript(tracker, STRAIGHT_THROUGH);
    const path = steps.map((s) => s.estimate.stateIndex);
    // States 2,3 are the first chorus; 6,7 the second. Continuity must land on
    // 6,7 (not 2,3) when the chorus repeats near the end.
    expect(path).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('recovers when the performer restarts from the top mid-song', () => {
    const tracker = createFollowTracker(SONG);
    const restart: CannedEvent[] = [
      // in a chorus...
      { at: 0, words: w('hold me now under the northern light') },
      { at: 2000, words: w('never let me go into the night') },
      // ...then restarts from the top and sings verse 1 through into the chorus
      { at: 4000, words: w('walking down the empty road') },
      { at: 6000, words: w('thinking of the words you said') },
      { at: 8000, words: w('hold me now under the northern light') },
    ];
    const steps = replayScript(tracker, restart);
    // Relocated to the top and resolved the chorus as the FIRST one (state 2),
    // not the one it was in before the restart (state 6).
    expect(steps[steps.length - 1]!.estimate.stateIndex).toBe(2);
  });
});

describe('scriptFromSong', () => {
  it('emits each lyric line in order at a fixed cadence', () => {
    const script = scriptFromSong(SONG, 2000);
    expect(script).toHaveLength(8);
    expect(script[0]).toEqual({ at: 0, words: w('walking down the empty road') });
    expect(script[1]!.at).toBe(2000);
    expect(script[7]!.at).toBe(14000);
  });

  it('and that script, replayed, tracks its own song straight through', () => {
    const tracker = createFollowTracker(SONG);
    const path = replayScript(tracker, scriptFromSong(SONG, 2500)).map((s) => s.estimate.stateIndex);
    expect(path).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('produces an empty script for a chords-only song', () => {
    expect(scriptFromSong('[Intro]\nC G Am F')).toEqual([]);
  });
});

describe('createCannedSignal — self-driving on timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits scripted words at their scheduled times', () => {
    vi.useFakeTimers();
    const got: SignalTokens[] = [];
    const signal = createCannedSignal([
      { at: 0, words: ['alpha'] },
      { at: 1000, words: ['beta'] },
    ]);
    signal.start((tok) => got.push(tok));

    vi.advanceTimersByTime(0);
    expect(got.map((g) => g.words)).toEqual([['alpha']]);

    vi.advanceTimersByTime(1000);
    expect(got.map((g) => g.words)).toEqual([['alpha'], ['beta']]);
    expect(typeof got[1]!.t).toBe('number');
  });

  it('stop() cancels pending emissions', () => {
    vi.useFakeTimers();
    const got: SignalTokens[] = [];
    const signal = createCannedSignal([
      { at: 0, words: ['alpha'] },
      { at: 1000, words: ['beta'] },
    ]);
    signal.start((tok) => got.push(tok));
    vi.advanceTimersByTime(0);
    signal.stop();
    vi.advanceTimersByTime(5000);
    expect(got.map((g) => g.words)).toEqual([['alpha']]);
  });
});
