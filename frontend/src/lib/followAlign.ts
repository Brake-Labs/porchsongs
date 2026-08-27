/**
 * Follow-mode lyric alignment (pure, no DOM, no audio).
 *
 * The job: given a stream of recognized words and a song whose lyric lines are
 * known and ordered, estimate which lyric line the performer is currently on so
 * the play view can scroll/highlight it.
 *
 * Why this is not a greedy "nearest matching line" search: real performers
 * repeat choruses, restart from the top, and jump around out of the written
 * order. A greedy forward matcher ping-pongs across identical chorus lines and
 * physically cannot follow a restart. So we track a probability distribution
 * over line POSITIONS (indices), not over text. The two copies of a chorus line
 * are distinct states, disambiguated by where you were a moment ago.
 *
 * The estimator is a small online Bayes filter (a discrete forward algorithm):
 *
 *   posterior_i  ∝  emission_i · Σ_j posterior_j · T(j → i)
 *
 *   emission_i   how well the recent word window matches lyric line i
 *   T(j → i)     transition prior: favors stay/+1/+2, allows small backward
 *                steps, and gives EVERY line a small uniform "teleport" floor.
 *                That floor is the whole reason restarts and out-of-order
 *                playing can be followed at all.
 *
 * This module only reports position + ambiguity. It never calls an LLM and never
 * touches the DOM. When it flags sustained ambiguity, the caller (a React hook)
 * may consult a gated async arbiter; that lives outside this pure core.
 */

import { isChordNoiseToken, isChordShaped, isNoChordToken } from '@/lib/chords/chordToken';

export type LineKind = 'chord' | 'lyric' | 'section' | 'blank';

/** One lyric line: the rendered-line index to scroll to, and its normalized tokens. */
export interface LyricState {
  /** Index into the song's rendered lines (0-based, counting every line). */
  renderIndex: number;
  /** Normalized word tokens used for matching. */
  tokens: string[];
}

export interface NormalizedSong {
  /** Kind of every rendered line, parallel to `text.split('\n')`. */
  lineKind: LineKind[];
  /** The filter's states, one per lyric line, in reading order. */
  lyricStates: LyricState[];
  /** False when the song has no lyric lines (instrumental / chords-only / empty). */
  hasLyrics: boolean;
}

export type FollowStatus = 'disabled' | 'searching' | 'locked' | 'ambiguous';

/**
 * Where an estimate came from, which is what says how much it should be trusted to
 * move the page a long way.
 *
 *   'audio'    inferred from recognized words. Can be wrong about which verse.
 *   'arbiter'  the LLM's answer to an ambiguity. A guess, softly applied.
 *   'human'    the performer tapped a line. This is not a guess; it is the answer.
 */
export type FollowOrigin = 'audio' | 'arbiter' | 'human';

export interface FollowCandidate {
  stateIndex: number;
  renderIndex: number;
  p: number;
}

export interface FollowEstimate {
  status: FollowStatus;
  /** Rendered line to center/highlight, or null when disabled. */
  renderIndex: number | null;
  /** Index into `lyricStates`, or null when disabled. */
  stateIndex: number | null;
  /** Posterior mass on the top state (0..1). */
  confidence: number;
  /**
   * Posterior mass within `nearRadius` lines of the top state (0..1).
   *
   * This, not `confidence`, is the honest answer to "do we know where in the song
   * we are". Repeated and near-repeated lines sit next to each other constantly
   * (a couplet sung twice, a refrain line closing every verse), and they split
   * `confidence` between neighbours that mean the same place on screen. Judging
   * certainty by the single top line therefore under-reports it exactly when
   * tracking is going well, which is what kept the chart frozen mid-verse.
   */
  regionConfidence: number;
  /**
   * True when a position FAR from the top candidate is nearly as likely, i.e. we
   * cannot tell which part of the song this is.
   *
   * Deliberately not "the top two states are close". Measured over real sessions,
   * almost every close top-two pair is a pair of adjacent lines, where either
   * choice puts the same text on screen and holding still costs far more than
   * being one line out. The case worth holding for is the genuinely undecidable
   * one: verse 1 and verse 5 are word-for-word identical and the audio cannot say
   * which you are on. Only a rival more than `nearRadius` lines away can be that.
   */
  ambiguous: boolean;
  /**
   * Recency-weighted share of the top line's words actually present in the
   * recent window, in [0,1]. Distinct from `confidence`, which is posterior mass
   * and can be high with no evidence at all: fed nothing but unrelated words,
   * the transition prior alone piles belief up against the end of the song and
   * reports a confident lock on the final line. `support` is the check on that
   * (0 means "we are not hearing this line, we are only guessing").
   */
  support: number;
  /** What produced this estimate. See FollowOrigin. */
  origin: FollowOrigin;
  /** Top candidates (for the debug overlay and the LLM arbiter), highest first. */
  top: FollowCandidate[];
}

export interface FollowConfig {
  /** Words older than this (ms) are evicted from the rolling window. */
  windowMs: number;
  /** No observation for this long (ms) drops back to 'searching'. */
  staleMs: number;
  /** Recency half-life (ms): a word this old counts half as much in emission. */
  halfLifeMs: number;
  /** Min region posterior (see `regionConfidence`) to report 'locked'. */
  confThreshold: number;
  /** Min (top region - best distant rival region) gap to NOT be 'ambiguous'. */
  marginThreshold: number;
  /**
   * How many lines either side of the top candidate count as "the same place".
   *
   * Two lines: the chart is centred on the top line, so a neighbour within two is
   * on screen and reads as correct. It is also the width of the smallest genuine
   * repeat (a line sung twice in a row), which is the pair that should never be
   * treated as a disagreement about position.
   */
  nearRadius: number;
  /** Uniform per-line probability floor added before renormalizing (restart/jump). */
  teleport: number;
  /** Forward transition reach (lines). */
  maxForward: number;
  /** Backward transition reach (lines). */
  maxBackward: number;
  /** Relative weight of a single backward step vs a forward step. */
  backwardBias: number;
  /** Emission floor so an unmatched line never gets exactly zero probability. */
  emissionFloor: number;
  /**
   * Exponent applied to emission. >1 sharpens it, so a clear, unambiguous line
   * match can overcome the forward-transition prior (this is what lets a restart
   * or a deliberate jump be followed instead of the tracker drifting forward).
   */
  emissionSharpness: number;
  /** How many candidates to surface in `top`. */
  topK: number;
}

export const DEFAULT_FOLLOW_CONFIG: FollowConfig = {
  windowMs: 6000,
  staleMs: 4000,
  halfLifeMs: 2500,
  confThreshold: 0.45,
  marginThreshold: 0.12,
  nearRadius: 2,
  teleport: 0.008,
  maxForward: 2,
  maxBackward: 4,
  backwardBias: 0.4,
  emissionFloor: 0.01,
  emissionSharpness: 1.8,
  topK: 3,
};

const SECTION_LINE = /^\[.+\]$/;

// Header/metadata lines that are not lyrics even without [Section] markers:
// "Key: G", "Tempo: 120 BPM", "Time: 4/4", "Capo: 2", "Chords used:", "Title: ..."
const METADATA_PREFIX = /^(key|tempo|time|capo|bpm|tuning|chords?\s+used|title|artist)\b\s*[:|-]/i;
// Chord-chart legend rows: "G - 320003", "C - x32010", "D7 - xx0212".
// Split rather than matched whole, so the chord half goes through the shared
// grammar instead of carrying a fourth private spelling of "looks like a chord".
const CHORD_LEGEND = /^(.+?)\s*[-–—]\s*([xX0-9]{4,6})$/;

function isChordLegendLine(trimmed: string): boolean {
  const m = CHORD_LEGEND.exec(trimmed);
  return m !== null && isChordShaped(m[1]!);
}

function isMetadataLine(trimmed: string): boolean {
  return METADATA_PREFIX.test(trimmed) || isChordLegendLine(trimmed);
}

/**
 * A line is a chord line when most of the tokens that are *not* chart furniture
 * look like chords.
 *
 * Bar lines and repeat marks are dropped from the denominator rather than
 * counted against the line. `| C | G |` is a chord row with two chords on it;
 * counting the three bar lines put it at 40% and classified it as a lyric.
 */
function isChordLine(trimmed: string): boolean {
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let considered = 0;
  let chords = 0;
  for (const token of tokens) {
    if (isChordNoiseToken(token)) continue;
    considered += 1;
    // "N.C." counts as a chord here: it only ever appears on a chord row, and a
    // row that is just "N.C." is still one.
    if (isChordShaped(token) || isNoChordToken(token)) chords += 1;
  }
  if (considered === 0) return false;
  return chords / considered >= 0.6;
}

/**
 * Normalize a lyric line to matchable word tokens: strip inline/bracketed tokens
 * ([C], [Chorus]), lowercase, drop punctuation (keeping intra-word apostrophes),
 * collapse whitespace.
 */
export function normalizeLyricTokens(line: string): string[] {
  return line
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Classify every rendered line and collect the lyric lines as filter states. */
export function normalizeSong(text: string): NormalizedSong {
  const lines = text.split('\n');
  const lineKind: LineKind[] = [];
  const lyricStates: LyricState[] = [];

  // Preamble (title, "Key: ...", "Chords used:", chord legend) sits before the
  // first [Section] marker and must NOT become lyric states, otherwise a title
  // like "When the Saints Go Marching In" competes with the real verses. If the
  // song has no section markers at all, every lyric line is eligible.
  const firstSection = lines.findIndex((l) => SECTION_LINE.test(l.trim()));

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed === '') {
      lineKind.push('blank');
      continue;
    }
    if (SECTION_LINE.test(trimmed)) {
      lineKind.push('section');
      continue;
    }
    if (isMetadataLine(trimmed)) {
      // Title/key/tempo/chord-legend: render it, but never a lyric target. This
      // is section-independent, so it also protects songs with no [Section]s.
      lineKind.push('blank');
      continue;
    }
    if (isChordLine(trimmed)) {
      lineKind.push('chord');
      continue;
    }
    const tokens = normalizeLyricTokens(lines[i]!);
    if (tokens.length === 0) {
      // A line that is only punctuation/brackets: treat as non-lyric.
      lineKind.push('blank');
      continue;
    }
    lineKind.push('lyric');
    if (firstSection < 0 || i > firstSection) {
      lyricStates.push({ renderIndex: i, tokens });
    }
  }

  return { lineKind, lyricStates, hasLyrics: lyricStates.length > 0 };
}

function jaccardRecall(windowSet: Set<string>, lineTokens: string[]): number {
  if (lineTokens.length === 0) return 0;
  const lineSet = new Set(lineTokens);
  let hit = 0;
  for (const t of lineSet) if (windowSet.has(t)) hit++;
  return hit / lineSet.size;
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

/**
 * Emission-style similarity in [0,1]: how much of `line` is present in the recent
 * `window`. Recall-based (not Jaccard-over-union) so a long window is not
 * penalized. Blends unigram and bigram recall; bigrams reward word order, which
 * helps distinguish lines that share a common vocabulary.
 */
export function similarity(window: string[], line: string[]): number {
  if (line.length === 0 || window.length === 0) return 0;
  const windowSet = new Set(window);
  const uni = jaccardRecall(windowSet, line);
  const lineBigrams = bigrams(line);
  if (lineBigrams.length === 0) return uni;
  const windowBigramSet = new Set(bigrams(window));
  let bi = 0;
  for (const bg of new Set(lineBigrams)) if (windowBigramSet.has(bg)) bi++;
  bi /= new Set(lineBigrams).size;
  return 0.5 * uni + 0.5 * bi;
}

interface Timed {
  word: string;
  t: number;
}

/**
 * Recency-weighted presence of window tokens: each unigram and ordered bigram
 * maps to a weight in (0,1] that decays with age (half-life = `halfLifeMs`). So
 * the line being sung right now dominates emission and stale words fade out,
 * which is what keeps a rolling window from smearing across many past lines.
 */
function recencyPresence(
  windowWords: Timed[],
  now: number,
  halfLifeMs: number,
): { uni: Map<string, number>; bi: Map<string, number> } {
  const uni = new Map<string, number>();
  const bi = new Map<string, number>();
  const weightAt = (t: number) => Math.pow(0.5, (now - t) / halfLifeMs);
  for (let i = 0; i < windowWords.length; i++) {
    const cur = windowWords[i]!;
    const wt = weightAt(cur.t);
    if (wt > (uni.get(cur.word) ?? 0)) uni.set(cur.word, wt);
    if (i + 1 < windowWords.length) {
      const nxt = windowWords[i + 1]!;
      const key = `${cur.word} ${nxt.word}`;
      const bw = Math.min(wt, weightAt(nxt.t));
      if (bw > (bi.get(key) ?? 0)) bi.set(key, bw);
    }
  }
  return { uni, bi };
}

/** Recency-weighted recall of a line against the window presence maps, in [0,1]. */
function weightedEmission(
  presence: { uni: Map<string, number>; bi: Map<string, number> },
  lineTokens: string[],
): number {
  if (lineTokens.length === 0) return 0;
  const lineSet = new Set(lineTokens);
  let uni = 0;
  for (const tok of lineSet) uni += presence.uni.get(tok) ?? 0;
  uni /= lineSet.size;

  const lineBigrams = new Set(bigrams(lineTokens));
  if (lineBigrams.size === 0) return uni;
  let bi = 0;
  for (const bg of lineBigrams) bi += presence.bi.get(bg) ?? 0;
  bi /= lineBigrams.size;
  return 0.5 * uni + 0.5 * bi;
}

/**
 * Share of what we recently HEARD that belongs to this line, recency-weighted.
 *
 * Precision, deliberately, not recall. `weightedEmission` divides by the line's
 * own length, which is right for the posterior but wrong as a "is this working"
 * signal: a degraded recognizer returning two correct words of a thirteen-word
 * lyric scores about 0.08, so a chart that is following along perfectly would be
 * branded "not matching". That is the exact regime this signal exists to judge,
 * and a warning that fires wrongly is worse than no warning.
 *
 * Precision keeps the property that matters. Unrelated speech still scores 0,
 * because none of those words appear in the line, while sparse-but-correct
 * recognition scores high regardless of how wordy the line is.
 */
function weightedPrecision(
  presence: { uni: Map<string, number> },
  lineTokens: string[],
): number {
  if (lineTokens.length === 0) return 0;
  const lineSet = new Set(lineTokens);
  let hit = 0;
  let total = 0;
  for (const [tok, w] of presence.uni) {
    total += w;
    if (lineSet.has(tok)) hit += w;
  }
  return total === 0 ? 0 : hit / total;
}

export interface FollowTracker {
  readonly song: NormalizedSong;
  /** Feed newly recognized words; returns the current estimate. */
  observe(words: string[], now: number): FollowEstimate;
  /** Human reposition (manual scroll/tap): collapse the posterior onto a line. */
  collapseTo(stateIndex: number, now: number): FollowEstimate;
  /**
   * Soft reposition from the LLM arbiter: firmly favor a state to resolve an
   * ambiguity, but less absolutely than a human reposition, so a wrong arbiter
   * call is still recoverable from subsequent audio.
   */
  nudge(stateIndex: number, now: number): FollowEstimate;
  /** Clear the window and reset to a uniform prior. */
  reset(): void;
}

/**
 * Build a stateful position filter for a song. Construct once per
 * (song, version); rebuild when the lyric set changes.
 */
export function createFollowTracker(
  text: string,
  config: Partial<FollowConfig> = {},
): FollowTracker {
  const cfg = { ...DEFAULT_FOLLOW_CONFIG, ...config };
  const song = normalizeSong(text);
  const L = song.lyricStates.length;

  let posterior: number[] = uniform(L);
  let windowWords: Timed[] = [];
  let lastObserve = -Infinity;
  // Per-state emission from the most recent observation, so an estimate can say
  // how much of its answer came from heard words rather than from the prior.
  let support: number[] = new Array<number>(L).fill(0);

  function uniform(n: number): number[] {
    return n === 0 ? [] : new Array<number>(n).fill(1 / n);
  }

  /** Predicted prior after one transition step, with the teleport floor folded in. */
  function predict(prev: number[]): number[] {
    const next = new Array<number>(L).fill(0);
    for (let j = 0; j < L; j++) {
      const pj = prev[j]!;
      if (pj === 0) continue;
      for (let i = 0; i < L; i++) {
        const w = transitionWeight(i - j, cfg);
        if (w > 0) next[i]! += pj * w;
      }
    }
    // Uniform teleport floor: gives every line a way back in (restart / jump).
    for (let i = 0; i < L; i++) next[i]! += cfg.teleport;
    return normalize(next);
  }

  function estimateFrom(post: number[], now: number, origin: FollowOrigin): FollowEstimate {
    if (L === 0) {
      return {
        status: 'disabled',
        renderIndex: null,
        stateIndex: null,
        confidence: 0,
        regionConfidence: 0,
        ambiguous: false,
        support: 0,
        origin,
        top: [],
      };
    }
    const order = post
      .map((p, stateIndex) => ({
        stateIndex,
        renderIndex: song.lyricStates[stateIndex]!.renderIndex,
        p,
      }))
      .sort((a, b) => b.p - a.p);

    const top = order.slice(0, cfg.topK);
    const best = order[0]!;
    const near = (i: number) => Math.abs(i - best.stateIndex) <= cfg.nearRadius;

    // Belief that we are HERE, meaning within a couple of lines of the top pick.
    const regionConfidence = regionMass(post, best.stateIndex, cfg.nearRadius);

    // The strongest claim that we are somewhere else entirely, measured the same
    // way so the two are comparable. `order` is sorted, so the first candidate
    // outside the top region is the best rival there is.
    const rival = order.find((c) => !near(c.stateIndex));
    const rivalMass =
      rival == null
        ? 0
        : // Its own region, minus anything already counted as "here", so the two
          // masses never double-count the lines between two close-ish clusters.
          regionMass(post, rival.stateIndex, cfg.nearRadius, near);
    const ambiguous = regionConfidence - rivalMass < cfg.marginThreshold;
    const stale = now - lastObserve > cfg.staleMs;

    let status: FollowStatus;
    if (stale || regionConfidence < cfg.confThreshold) status = 'searching';
    else if (ambiguous) status = 'ambiguous';
    else status = 'locked';

    return {
      status,
      renderIndex: best.renderIndex,
      stateIndex: best.stateIndex,
      confidence: best.p,
      regionConfidence,
      ambiguous,
      support: support[best.stateIndex] ?? 0,
      origin,
      top,
    };
  }

  return {
    song,

    observe(words: string[], now: number): FollowEstimate {
      if (L === 0) return estimateFrom(posterior, now, 'audio');

      if (words.length > 0) {
        lastObserve = now;
        for (const raw of words) {
          for (const w of normalizeLyricTokens(raw)) windowWords.push({ word: w, t: now });
        }
      }
      // Evict stale words from the rolling window.
      const cutoff = now - cfg.windowMs;
      windowWords = windowWords.filter((x) => x.t >= cutoff);

      const predicted = predict(posterior);

      // No usable observation: let the prior stand (diffused by the transition).
      if (windowWords.length === 0) {
        posterior = predicted;
        support = new Array<number>(L).fill(0);
        return estimateFrom(posterior, now, 'audio');
      }

      const presence = recencyPresence(windowWords, now, cfg.halfLifeMs);
      const updated = new Array<number>(L);
      for (let i = 0; i < L; i++) {
        const raw = weightedEmission(presence, song.lyricStates[i]!.tokens);
        // The posterior keeps using recall-shaped emission; `support` is a
        // separate precision-shaped read, so changing one cannot move the other.
        support[i] = weightedPrecision(presence, song.lyricStates[i]!.tokens);
        updated[i] = predicted[i]! * Math.pow(Math.max(cfg.emissionFloor, raw), cfg.emissionSharpness);
      }
      const norm = updated.reduce((a, b) => a + b, 0);
      // If everything collapsed to zero (shouldn't, given the floor), keep the prior.
      posterior = norm > 0 ? updated.map((x) => x / norm) : predicted;
      return estimateFrom(posterior, now, 'audio');
    },

    collapseTo(stateIndex: number, now: number): FollowEstimate {
      if (L === 0) return estimateFrom(posterior, now, 'human');
      const clamped = Math.max(0, Math.min(L - 1, stateIndex));
      // A human reposition is near-certain: leave only a tiny floor elsewhere so
      // one contradicting observation can't immediately teleport the lock away.
      const spread = 0.02 / L;
      posterior = new Array<number>(L).fill(spread);
      posterior[clamped]! += 0.98;
      posterior = normalize(posterior);
      // A human put us here, not the audio: claim no evidence for it.
      support = new Array<number>(L).fill(0);
      lastObserve = now;
      return estimateFrom(posterior, now, 'human');
    },

    nudge(stateIndex: number, now: number): FollowEstimate {
      if (L === 0) return estimateFrom(posterior, now, 'arbiter');
      const clamped = Math.max(0, Math.min(L - 1, stateIndex));
      // Blend the current posterior toward the chosen state: firm enough to
      // resolve a near-tie, soft enough that later audio can still override it.
      const blended = posterior.map((p, i) => 0.5 * p + (i === clamped ? 0.5 : 0));
      posterior = normalize(blended);
      // Like collapseTo: the arbiter moved us, not the audio. Without this the
      // previous observation's per-state support survives onto a line it was
      // never measured against.
      support = new Array<number>(L).fill(0);
      lastObserve = now;
      return estimateFrom(posterior, now, 'arbiter');
    },

    reset(): void {
      posterior = uniform(L);
      windowWords = [];
      support = new Array<number>(L).fill(0);
      lastObserve = -Infinity;
    },
  };
}

/**
 * Transition weight for a step of `delta` lines (unnormalized). Staying and
 * advancing-by-one are weighted EQUALLY on purpose: a forward preference would,
 * over a long run of identical lines (a chorus that opens and closes the song),
 * slowly concentrate belief on the later copy until it wins outright and the
 * ambiguity guard stops firing. With no forward bias, identical copies stay
 * genuinely tied (so the UI holds), and real advancement still happens because a
 * different line's words give it higher emission.
 */
function transitionWeight(delta: number, cfg: FollowConfig): number {
  if (delta === 0) return 4; // stay
  if (delta === 1) return 4; // advance-by-one, equally weighted (no forward bias)
  if (delta === 2) return 1.5;
  if (delta >= 3 && delta <= cfg.maxForward) return 1.5 * Math.pow(0.5, delta - 2);
  if (delta < 0 && -delta <= cfg.maxBackward) return cfg.backwardBias * Math.pow(0.6, -delta - 1);
  return 0;
}

/**
 * Posterior mass within `radius` lines of `centre`, skipping any line `exclude`
 * accepts. Clamped to the song, so a region at the very top or bottom is simply
 * smaller rather than wrapping or reading off the end.
 */
function regionMass(
  post: number[],
  centre: number,
  radius: number,
  exclude?: (i: number) => boolean,
): number {
  let sum = 0;
  const lo = Math.max(0, centre - radius);
  const hi = Math.min(post.length - 1, centre + radius);
  for (let i = lo; i <= hi; i++) {
    if (exclude?.(i)) continue;
    sum += post[i]!;
  }
  return sum;
}

function normalize(v: number[]): number[] {
  const sum = v.reduce((a, b) => a + b, 0);
  if (sum <= 0) return v.length === 0 ? v : new Array<number>(v.length).fill(1 / v.length);
  return v.map((x) => x / sum);
}
