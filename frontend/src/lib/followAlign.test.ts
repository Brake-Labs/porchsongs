import {
  normalizeSong,
  normalizeLyricTokens,
  similarity,
  createFollowTracker,
} from './followAlign';

// A song with two identical choruses (lyric states 2,3 == 6,7) so the repeated-line
// and continuity behavior can be exercised.
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

// Lyric-state tokens, in reading order, for feeding the tracker.
const LINES = {
  v1a: normalizeLyricTokens('walking down the empty road'), // state 0
  v1b: normalizeLyricTokens('thinking of the words you said'), // state 1
  chA1: normalizeLyricTokens('hold me now under the northern light'), // state 2 / 6
  chA2: normalizeLyricTokens('never let me go into the night'), // state 3 / 7
  v2a: normalizeLyricTokens('morning breaks and you are gone away'), // state 4
  v2b: normalizeLyricTokens('still i sing this very lonely song'), // state 5
};

describe('normalizeLyricTokens', () => {
  it('lowercases, strips punctuation, keeps intra-word apostrophes', () => {
    expect(normalizeLyricTokens("Don't Look, Back!")).toEqual(["don't", 'look', 'back']);
  });

  it('strips bracketed inline chords and section markers', () => {
    expect(normalizeLyricTokens('[C]hold [G]me now')).toEqual(['hold', 'me', 'now']);
  });
});

describe('normalizeSong', () => {
  const song = normalizeSong(SONG);

  it('classifies section, chord, lyric, and blank lines', () => {
    expect(song.lineKind[0]).toBe('section'); // [Verse 1]
    expect(song.lineKind[1]).toBe('chord'); // C  G
    expect(song.lineKind[2]).toBe('lyric'); // walking down...
    expect(song.lineKind[5]).toBe('blank');
  });

  it('collects one state per lyric line in reading order', () => {
    expect(song.hasLyrics).toBe(true);
    expect(song.lyricStates).toHaveLength(8);
    expect(song.lyricStates[0]!.tokens).toEqual(LINES.v1a);
    // The two choruses produce identical token lists at different render indices.
    expect(song.lyricStates[2]!.tokens).toEqual(song.lyricStates[6]!.tokens);
    expect(song.lyricStates[2]!.renderIndex).not.toBe(song.lyricStates[6]!.renderIndex);
  });

  it('reports no lyrics for a chords-only / instrumental song (no throw)', () => {
    const instrumental = normalizeSong(['[Intro]', 'C   G   Am   F', 'C   G   F   C'].join('\n'));
    expect(instrumental.hasLyrics).toBe(false);
    expect(instrumental.lyricStates).toEqual([]);
  });

  it('reports no lyrics for empty text (no throw)', () => {
    expect(normalizeSong('').hasLyrics).toBe(false);
  });
});

describe('similarity', () => {
  it('is 1 when the window contains the whole line', () => {
    expect(similarity(['walking', 'down', 'the', 'empty', 'road'], LINES.v1a)).toBeCloseTo(1, 5);
  });

  it('is 0 for disjoint token sets', () => {
    expect(similarity(['completely', 'different', 'words'], LINES.v1a)).toBe(0);
  });

  it('is not penalized by a long window (recall-based)', () => {
    const big = [...LINES.v1a, ...LINES.v2a, ...LINES.v2b];
    expect(similarity(big, LINES.v1a)).toBeCloseTo(1, 5);
  });
});

describe('createFollowTracker — basic locking', () => {
  it('is disabled for a chords-only song', () => {
    const t = createFollowTracker('[Intro]\nC G Am F');
    expect(t.observe(['anything'], 1000).status).toBe('disabled');
  });

  it('locks onto the line being sung', () => {
    const t = createFollowTracker(SONG);
    t.observe(LINES.v1a, 1000);
    const est = t.observe(LINES.v1a, 1500);
    expect(est.stateIndex).toBe(0);
    expect(est.status).toBe('locked');
    expect(est.confidence).toBeGreaterThan(0.45);
  });

  it('advances forward as the next line is sung', () => {
    const t = createFollowTracker(SONG);
    t.observe(LINES.v1a, 1000);
    const est = t.observe(LINES.v1b, 1500);
    expect(est.stateIndex).toBe(1);
  });

  it('drops back to searching after staleness with no observations', () => {
    const t = createFollowTracker(SONG);
    t.observe(LINES.v1a, 1000);
    t.observe(LINES.v1a, 1500);
    const stale = t.observe([], 1500 + 5000); // > staleMs (4000)
    expect(stale.status).toBe('searching');
  });
});

describe('createFollowTracker — repeated choruses', () => {
  it('follows the NEAREST-AHEAD chorus (continuity disambiguates identical lines)', () => {
    const t = createFollowTracker(SONG);
    // Position deep in verse 2 (state 5), then sing the chorus, which matches
    // both state 2 (behind) and state 6 (ahead) equally by text.
    t.collapseTo(5, 1000);
    const est = t.observe(LINES.chA1, 1500);
    expect(est.stateIndex).toBe(6); // the chorus AHEAD, not the one behind
  });

  it('stays on the first chorus when arriving from verse 1', () => {
    const t = createFollowTracker(SONG);
    t.collapseTo(1, 1000); // end of verse 1
    const est = t.observe(LINES.chA1, 1500);
    expect(est.stateIndex).toBe(2); // the nearest-ahead chorus is the FIRST one
  });
});

describe('createFollowTracker — restart (backward jump needs sustained evidence)', () => {
  it('does not jump back to the top on a single observation', () => {
    const t = createFollowTracker(SONG);
    t.collapseTo(6, 1000); // deep in the second chorus
    const est = t.observe(LINES.v1a, 1500); // suddenly the first line
    expect(est.stateIndex).not.toBe(0); // hysteresis: one observation is not enough
  });

  it('relocates to the top after the restart is sustained', () => {
    const t = createFollowTracker(SONG);
    t.collapseTo(6, 1000);
    let est = t.observe(LINES.v1a, 1500);
    for (let i = 0; i < 6; i++) est = t.observe(LINES.v1a, 2000 + i * 500);
    expect(est.stateIndex).toBe(0);
  });
});

describe('createFollowTracker — out-of-order / manual reposition', () => {
  it('follows a forward jump to a distant section', () => {
    const t = createFollowTracker(SONG);
    t.collapseTo(0, 1000);
    let est = t.observe(LINES.v2b, 1500); // jump from line 0 to state 5
    est = t.observe(LINES.v2b, 2000);
    expect(est.stateIndex).toBe(5);
  });

  it('snaps to a human reposition and treats it as near-certain', () => {
    const t = createFollowTracker(SONG);
    t.observe(LINES.v1a, 1000);
    const est = t.collapseTo(3, 1200);
    expect(est.stateIndex).toBe(3);
    expect(est.confidence).toBeGreaterThan(0.8);
    expect(est.status).toBe('locked');
  });

  it('nudge softly favors a state (firmer than a tie, softer than a human snap)', () => {
    const t = createFollowTracker(SONG);
    const est = t.nudge(3, 1000);
    expect(est.stateIndex).toBe(3);
    // Firm enough to lead, but not the near-certain 0.98 of collapseTo.
    expect(est.confidence).toBeGreaterThan(0.4);
    expect(est.confidence).toBeLessThan(0.85);
  });
});
