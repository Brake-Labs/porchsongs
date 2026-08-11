/**
 * End-to-end tracking quality: does the chart stay with the performer, and does it
 * ever leap somewhere far from where they are?
 *
 * The unit tests either side of this one check single decisions. This one plays a
 * whole song through the real pipeline (tracker -> commit rule) and asserts the two
 * properties a performer actually feels:
 *
 *   LAG   the committed line never falls far behind the line being sung
 *   LEAP  the committed line never moves a long way in one step
 *
 * They are the same defect seen from two ends. Reported as "Follow jumps far away
 * from where it is supposed to be", the mechanism was lag: the commit rule refused
 * to move while the top two candidates were close, that happened on nearly every
 * observation because adjacent lines of a repetitive song are always close, and so
 * the chart sat still for a whole verse and then caught up in one leap. Measured on
 * the fixture below it drifted thirteen lines behind and then jumped twelve.
 *
 * Deliberately no randomness: a flaky quality test gets deleted rather than fixed.
 * The recognizer degradation is a fixed pattern, and every threshold below has real
 * headroom over what this pipeline currently achieves.
 */

import { createFollowTracker, normalizeSong, type FollowEstimate } from './followAlign';
import { commitFollowEstimate, INITIAL_COMMIT_STATE } from './followCommit';

// Five verses, four lines each, over an identical closing verse and a shared refrain
// line ("Oh Lord I want to be in that number") that ends every verse. This is the
// hard case: at any moment several lines fit what was just heard.
const SAINTS = [
  'When the Saints Go Marching In', 'Traditional / Public Domain', '',
  'Key: G | Tempo: 120 BPM', '',
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

/** Words a recognizer offers instead of the one that was sung. */
const MISHEARS = ['the', 'and', 'or', 'oh', 'when', 'i', 'like', 'this', 'that', 'in'];

const LINE_MS = 2500;

interface Heard {
  t: number;
  words: string[];
  /** The lyric-state index actually being sung at `t`. */
  truth: number;
}

/**
 * A performance of `songText`, sung straight through, as a real recognizer would
 * report it: only some of the words, a few of them wrong, arriving in small
 * batches several times per line rather than one tidy batch per line.
 *
 * `emitMs` is the gap between batches. Both extremes are worth testing and they
 * are genuinely different regimes: the browser recognizer emits an interim result
 * every few hundred ms, while a device that only reports finalized phrases emits
 * about once a line.
 */
function perform(songText: string, emitMs: number): Heard[] {
  const states = normalizeSong(songText).lyricStates;
  const out: Heard[] = [];
  let dropCounter = 0;
  let mishearCounter = 0;
  states.forEach((state, truth) => {
    const heard: string[] = [];
    for (const token of state.tokens) {
      // Fixed 1-in-3 dropout, 1-in-7 mishear, counted across the whole session so
      // the damage lands on different words of each line.
      if (dropCounter++ % 3 === 0) continue;
      heard.push(mishearCounter++ % 7 === 0 ? MISHEARS[mishearCounter % MISHEARS.length]! : token);
    }
    const batches = Math.max(1, Math.round(LINE_MS / emitMs));
    const perBatch = Math.ceil(heard.length / batches) || 1;
    for (let b = 0; b < batches; b++) {
      const words = heard.slice(b * perBatch, (b + 1) * perBatch);
      if (words.length === 0) continue;
      out.push({ t: truth * LINE_MS + Math.round((b * LINE_MS) / batches), words, truth });
    }
  });
  return out;
}

interface Trace {
  /** Worst gap between the committed line and the line being sung, in lyric lines. */
  maxLag: number;
  /** Largest single move of the committed line, in lyric lines. */
  maxLeap: number;
  /** Mean absolute gap, in lyric lines. */
  meanLag: number;
}

function play(songText: string, heard: Heard[]): Trace {
  const tracker = createFollowTracker(songText);
  let commit = INITIAL_COMMIT_STATE;
  // Follow starts by placing the performer at the top of the song, as the hook does.
  commit = commitFollowEstimate(commit, tracker.collapseTo(0, -1), -1);

  let maxLag = 0;
  let maxLeap = 0;
  let total = 0;
  for (const { t, words, truth } of heard) {
    const before = commit.stateIndex ?? 0;
    const est: FollowEstimate = tracker.observe(words, t);
    commit = commitFollowEstimate(commit, est, t);
    const now = commit.stateIndex ?? 0;
    maxLeap = Math.max(maxLeap, Math.abs(now - before));
    const lag = Math.abs(now - truth);
    maxLag = Math.max(maxLag, lag);
    total += lag;
  }
  return { maxLag, maxLeap, meanLag: total / heard.length };
}

describe('follow tracking quality on a degraded, repetitive performance', () => {
  // Once per line (a device that reports only finalized phrases) and several times
  // per line (the browser recognizer's interim results).
  for (const emitMs of [2500, 400]) {
    describe(`recognizer emitting every ${emitMs}ms`, () => {
      const trace = play(SAINTS, perform(SAINTS, emitMs));

      it('keeps the chart with the performer', () => {
        // Within a line or two is a chart that reads as correct: the sung line is
        // on screen. Before the region-ambiguity fix this reached 13.
        expect(trace.maxLag).toBeLessThanOrEqual(3);
        expect(trace.meanLag).toBeLessThan(1);
      });

      it('never leaps a long way in one move', () => {
        // A verse of this song is four lines, so five is "somewhere else entirely".
        // Before the fix a single move of 12 happened: the catch-up after the lag.
        expect(trace.maxLeap).toBeLessThanOrEqual(4);
      });
    });
  }
});
