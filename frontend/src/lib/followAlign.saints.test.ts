import { createFollowTracker } from './followAlign';

// Regression fixture built from a REAL recorded mic session of "When the Saints
// Go Marching In" (five near-identical verses + a title that is word-for-word the
// chorus). This is the worst case for repetition + header decoys.
const SONG = [
  'When the Saints Go Marching In', 'Traditional / Public Domain', '',
  'Key: G | Tempo: 120 BPM | Time: 4/4', '', 'Chords used:', 'G - 320003', 'G7 - 320001',
  'C - x32010', 'D - xx0232', 'D7 - xx0212', '',
  '[Verse 1]', 'G', 'Oh when the saints go marching in,', '                              D',
  'Oh when the saints go marching in,', 'G                    G7           C',
  'Oh Lord I want to be in that number,', 'G            D7          G',
  'When the saints go marching in.', '',
  '[Verse 2]', 'G', 'Oh when the sun refuse to shine,', '                              D',
  'Oh when the sun refuse to shine,', 'G                    G7           C',
  'Oh Lord I want to be in that number,', 'G            D7            G',
  'When the sun refuse to shine.', '',
  '[Verse 3]', 'G', 'Oh when the trumpet sounds its call,', '                                  D',
  'Oh when the trumpet sounds its call,', 'G                    G7           C',
  'Oh Lord I want to be in that number,', 'G              D7                G',
  'When the trumpet sounds its call.', '',
  '[Verse 4]', 'G', 'Oh when the new world is revealed,', '                                  D',
  'Oh when the new world is revealed,', 'G                    G7           C',
  'Oh Lord I want to be in that number,', 'G              D7                G',
  'When the new world is revealed.', '',
  '[Verse 5]', 'G', 'Oh when the saints go marching in,', '                              D',
  'Oh when the saints go marching in,', 'G                    G7           C',
  'Oh Lord I want to be in that number,', 'G            D7          G',
  'When the saints go marching in.',
].join('\n');

// The words the recognizer actually produced per sung line (mishears included),
// i.e. the clean incremental stream the fixed SpeechSignal emits.
const STREAM: [number, string[]][] = [
  [7000, ['oh', 'and', 'the', 'saints', 'go', 'marching', 'in']],
  [9500, ['oh', 'when', 'the', 'saints', 'go', 'marching', 'in']],
  [16000, ['oh', 'lord', 'i', 'want', 'to', 'be', 'in', 'the', 'number']],
  [20500, ['when', 'the', 'saints', 'go', 'marching', 'in']],
  [25000, ['oh', 'when', 'the', 'sun', 'refuse', 'to', 'shine']],
  [29000, ['or', 'when', 'the', 'sun', 'refuse', 'to', 'shine']],
  [33500, ['or', 'i', 'want', 'to', 'be', 'in', 'the', 'number']],
  [36900, ['when', 'the', 'sun', 'refuse', 'to', 'shine']],
  [40000, ['or', 'when', 'the', 'tribe', "it's", 'on', 'the', 'call']],
  [42000, ['when', 'the', 'trumpet', 'sounds', "it's", 'cold']],
  [43500, ['i', 'want', 'to', 'be', 'in', 'the', 'number']],
  [44500, ['when', 'the', 'trumpet', 'sounds', "it's", 'cold']],
  [52000, ['when', 'the', 'new', 'world', 'is', 'revealed']],
  [53500, ['i', 'want', 'the', 'same']],
  [56000, ['school', 'marching', 'in']],
  [58000, ['although', 'i', 'want', 'to', 'be', 'in', 'the', 'number']],
  [59500, ['when', 'the', 'saints', 'go', 'marching', 'in']],
];

describe('followAlign on a real repetitive performance (Saints)', () => {
  it('does not treat the title/metadata as lyric lines', () => {
    const t = createFollowTracker(SONG);
    // First real lyric line is render index 14 ("Oh when the saints go marching in,").
    expect(t.song.lyricStates[0]!.renderIndex).toBe(14);
    // 4 lyric lines x 5 verses = 20 states (title + legend excluded).
    expect(t.song.lyricStates).toHaveLength(20);
  });

  it('tracks the performance forward through all five verses without title-lock', () => {
    const t = createFollowTracker(SONG);
    t.collapseTo(0, 0);
    const seen = STREAM.map(([at, words]) => t.observe(words, at).renderIndex ?? -1);

    // Never locks onto the title/preamble (everything before render 14).
    for (const idx of seen) expect(idx).toBeGreaterThanOrEqual(14);

    const at = (ms: number) => seen[STREAM.findIndex((s) => s[0] === ms)]!;
    // Distinguishing lines land in the right verse's render range.
    expect(at(16000)).toBeGreaterThanOrEqual(14); // verse 1
    expect(at(16000)).toBeLessThanOrEqual(20);
    expect(at(36900)).toBeGreaterThanOrEqual(22); // verse 2 ("...sun refuse to shine")
    expect(at(36900)).toBeLessThanOrEqual(30);
    expect(at(44500)).toBeGreaterThanOrEqual(32); // verse 3 ("...trumpet")
    expect(at(44500)).toBeLessThanOrEqual(40);
    expect(at(52000)).toBeGreaterThanOrEqual(42); // verse 4 ("...new world")
    expect(at(52000)).toBeLessThanOrEqual(50);
    expect(at(59500)).toBeGreaterThanOrEqual(54); // verse 5 (final)
  });

  it('holds during an undecidable identical-verse stretch, then moves on a distinguishing line', () => {
    // Verse 1 and verse 5 are word-for-word identical, so the opening "saints go
    // marching in" stretch cannot say which verse you're on. The UI commit rule
    // (confident AND unambiguous) must hold rather than drift to the last verse.
    const t = createFollowTracker(SONG);
    t.collapseTo(0, 0);
    const canCommit = (e: ReturnType<typeof t.observe>) =>
      e.renderIndex != null && e.status !== 'disabled' && !e.ambiguous && e.confidence >= 0.3;
    let committed = 14;

    const saints = ['oh', 'when', 'the', 'saints', 'go', 'marching', 'in'];
    for (let k = 0; k < 6; k++) {
      const e = t.observe(saints, 1000 + k * 2500);
      if (canCommit(e)) committed = e.renderIndex!;
    }
    // Never drifts past verse 1/2 into a later identical verse during the stretch.
    expect(committed).toBeLessThan(34);

    const sun = ['when', 'the', 'sun', 'refuse', 'to', 'shine'];
    for (let k = 0; k < 3; k++) {
      const e = t.observe(sun, 20000 + k * 2500);
      if (canCommit(e)) committed = e.renderIndex!;
    }
    // The distinguishing line moves it into verse 2.
    expect(committed).toBeGreaterThanOrEqual(22);
    expect(committed).toBeLessThanOrEqual(30);
  });
});
