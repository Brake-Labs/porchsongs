/**
 * What the chart actually shows (pure: no DOM, no timers, no React).
 *
 * The tracker reports where it currently believes the performer is. That belief is
 * allowed to be jumpy: it is a posterior over every line in the song, and one
 * unlucky window of misheard words can briefly favour a line in another verse.
 * Following it literally is what makes Follow mode feel unreliable, because the
 * cost of a wrong move is wildly asymmetric:
 *
 *   one line out    barely noticed; the right text is still on screen
 *   a verse out     the performer loses their place and has to hunt for it
 *
 * So moves are not all treated alike. Continuing along the song commits
 * immediately, because that is the normal case and any delay reads as lag. A
 * relocation to somewhere else in the song has to earn it: the tracker must say so
 * more than once, and it must be hearing words that belong there rather than
 * arriving on prior alone. A restart from the top or a skipped verse still gets
 * followed, about a second later than before, and a single bad window no longer
 * throws the page across the song.
 *
 * A tap is exempt. The performer pointing at a line is not evidence to be weighed
 * against the audio, it is the answer, and making someone tap twice to be believed
 * would be worse than the problem this solves. The LLM arbiter is NOT exempt: it
 * guesses, it guesses from the same ambiguous audio, and a wrong guess is precisely
 * the far jump complained about. Corroborate it like anything else.
 */

import type { FollowEstimate } from './followAlign';
import { isCommittableEstimate } from './followHealth';

export interface FollowCommitConfig {
  /** A move further than this many lyric lines is a relocation, not following along. */
  jumpLines: number;
  /** Separate committable estimates agreeing on the new place before we move there. */
  jumpHits: number;
  /** Lines this far apart are not the same place, so they cannot corroborate each other. */
  jumpTolerance: number;
  /** A pending relocation with no fresh agreement for this long is dropped. */
  pendingMs: number;
  /**
   * Minimum `support` (share of recently heard words belonging to the line) before
   * a relocation is allowed at all.
   *
   * Continuing forward deliberately has no such requirement: an instrumental break
   * or a badly misheard line must not stop the chart following along. But a jump
   * across the song on no heard evidence is never right, and the transition prior
   * alone can produce a confident one (see FollowEstimate.support).
   */
  jumpSupport: number;
}

export const DEFAULT_FOLLOW_COMMIT: FollowCommitConfig = {
  jumpLines: 4,
  jumpHits: 2,
  jumpTolerance: 2,
  pendingMs: 2500,
  jumpSupport: 0.2,
};

export interface FollowCommitState {
  /** Rendered line the chart is showing, or null before anything is committed. */
  renderIndex: number | null;
  /** Lyric-state index behind `renderIndex`, or null. Distances are measured in these. */
  stateIndex: number | null;
  /** A distant position still gathering agreement, or null. */
  pending: { stateIndex: number; renderIndex: number; hits: number; at: number } | null;
}

export const INITIAL_COMMIT_STATE: FollowCommitState = {
  renderIndex: null,
  stateIndex: null,
  pending: null,
};

/**
 * Fold one estimate into the committed position.
 *
 * Pure and total: same inputs, same output, and every branch returns a state, so
 * the caller can hold this in a ref or a reducer without a stale-closure hazard.
 * Returns the previous state object unchanged when nothing moved, which lets a
 * React caller skip a re-render on identity.
 */
export function commitFollowEstimate(
  prev: FollowCommitState,
  est: FollowEstimate | null,
  now: number,
  cfg: FollowCommitConfig = DEFAULT_FOLLOW_COMMIT,
): FollowCommitState {
  // Not solid enough to act on. Any pending relocation is left alone rather than
  // cleared: a jump is often ambiguous for a moment as belief crosses over, and
  // discarding the evidence there would mean a real relocation could never
  // accumulate. It expires on `pendingMs` instead.
  if (!isCommittableEstimate(est) || est?.stateIndex == null || est.renderIndex == null) {
    return expirePending(prev, now, cfg);
  }

  const { stateIndex, renderIndex } = est;

  // First commit of the session: there is no place to be thrown away from. A tap
  // is the performer telling us where they are, so it is never second-guessed.
  if (prev.stateIndex == null || est.origin === 'human') {
    return { renderIndex, stateIndex, pending: null };
  }

  // Following along. Commit at once; a pending jump elsewhere is now moot.
  if (Math.abs(stateIndex - prev.stateIndex) <= cfg.jumpLines) {
    if (stateIndex === prev.stateIndex && prev.pending == null) return prev;
    return { renderIndex, stateIndex, pending: null };
  }

  // A relocation. Never on prior alone.
  if (est.support < cfg.jumpSupport) return expirePending(prev, now, cfg);

  const pending = prev.pending;
  const corroborates =
    pending != null &&
    now - pending.at <= cfg.pendingMs &&
    Math.abs(stateIndex - pending.stateIndex) <= cfg.jumpTolerance;

  if (!corroborates) {
    return { ...prev, pending: { stateIndex, renderIndex, hits: 1, at: now } };
  }

  const hits = pending.hits + 1;
  if (hits < cfg.jumpHits) {
    // Track the latest position, not the first: as belief settles the estimate
    // sharpens, and the later line is the better answer.
    return { ...prev, pending: { stateIndex, renderIndex, hits, at: now } };
  }
  return { renderIndex, stateIndex, pending: null };
}

function expirePending(
  prev: FollowCommitState,
  now: number,
  cfg: FollowCommitConfig,
): FollowCommitState {
  if (prev.pending == null || now - prev.pending.at <= cfg.pendingMs) return prev;
  return { ...prev, pending: null };
}
