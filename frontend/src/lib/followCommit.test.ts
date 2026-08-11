import {
  commitFollowEstimate,
  DEFAULT_FOLLOW_COMMIT,
  INITIAL_COMMIT_STATE,
  type FollowCommitState,
} from './followCommit';
import type { FollowEstimate, FollowOrigin } from './followAlign';

/** A committable estimate at `stateIndex`. Render index is deliberately not 2x. */
function est(
  stateIndex: number,
  over: Partial<FollowEstimate> = {},
): FollowEstimate {
  return {
    status: 'locked',
    stateIndex,
    renderIndex: stateIndex * 3 + 1,
    confidence: 0.7,
    regionConfidence: 0.8,
    ambiguous: false,
    support: 0.6,
    origin: 'audio',
    top: [],
    ...over,
  };
}

/** Committed at `stateIndex`, nothing pending. */
function at(stateIndex: number): FollowCommitState {
  return { stateIndex, renderIndex: stateIndex * 3 + 1, pending: null };
}

const { jumpLines, jumpHits, pendingMs, jumpSupport } = DEFAULT_FOLLOW_COMMIT;
const FAR = jumpLines + 6;

describe('commitFollowEstimate', () => {
  it('commits the first estimate of a session immediately', () => {
    const next = commitFollowEstimate(INITIAL_COMMIT_STATE, est(20), 1000);
    expect(next.stateIndex).toBe(20);
    expect(next.renderIndex).toBe(61);
  });

  it('commits a local move immediately', () => {
    const next = commitFollowEstimate(at(5), est(5 + jumpLines), 1000);
    expect(next.stateIndex).toBe(5 + jumpLines);
  });

  it('holds position for an estimate that is not solid enough', () => {
    for (const bad of [
      est(FAR, { ambiguous: true }),
      est(FAR, { regionConfidence: 0.1 }),
      est(FAR, { status: 'disabled', renderIndex: null }),
    ]) {
      expect(commitFollowEstimate(at(5), bad, 1000).stateIndex).toBe(5);
    }
    expect(commitFollowEstimate(at(5), null, 1000).stateIndex).toBe(5);
  });

  it('does not relocate on a single distant estimate', () => {
    const next = commitFollowEstimate(at(5), est(FAR), 1000);
    expect(next.stateIndex).toBe(5);
    expect(next.pending?.stateIndex).toBe(FAR);
  });

  it('relocates once the distant position is corroborated', () => {
    let state = at(5);
    for (let i = 0; i < jumpHits; i++) {
      state = commitFollowEstimate(state, est(FAR), 1000 + i * 400);
    }
    expect(state.stateIndex).toBe(FAR);
    expect(state.pending).toBeNull();
  });

  it('counts a nearby second reading as corroborating the same place', () => {
    let state = commitFollowEstimate(at(5), est(FAR), 1000);
    // Belief sharpens between readings, so the exact line moves a little. That is
    // the same relocation, and it commits to the newer line.
    state = commitFollowEstimate(state, est(FAR + 1), 1400);
    expect(state.stateIndex).toBe(FAR + 1);
  });

  it('does not let two unrelated distant readings corroborate each other', () => {
    let state = commitFollowEstimate(at(5), est(FAR), 1000);
    state = commitFollowEstimate(state, est(FAR + 20), 1400);
    expect(state.stateIndex).toBe(5);
    expect(state.pending?.stateIndex).toBe(FAR + 20);
    expect(state.pending?.hits).toBe(1);
  });

  it('forgets a stale pending relocation', () => {
    let state = commitFollowEstimate(at(5), est(FAR), 1000);
    state = commitFollowEstimate(state, est(FAR), 1000 + pendingMs + 1);
    expect(state.stateIndex).toBe(5);
    expect(state.pending?.hits).toBe(1);
  });

  it('never relocates on prior alone, however confident', () => {
    let state = at(5);
    const unheard = { confidence: 0.95, regionConfidence: 0.95, support: jumpSupport - 0.01 };
    for (let i = 0; i < jumpHits + 3; i++) {
      state = commitFollowEstimate(state, est(FAR, unheard), 1000 + i * 400);
    }
    expect(state.stateIndex).toBe(5);
  });

  it('follows a tap anywhere at once, with no support and no corroboration', () => {
    const tap = est(FAR, { origin: 'human', support: 0 });
    expect(commitFollowEstimate(at(5), tap, 1000).stateIndex).toBe(FAR);
  });

  it('makes the LLM arbiter advisory rather than authoritative', () => {
    // A nudge claims no heard evidence for the line it picked (the tracker zeroes
    // support), so on its own it cannot move the page across the song.
    const nudge = est(FAR, { origin: 'arbiter' as FollowOrigin, support: 0 });
    expect(commitFollowEstimate(at(5), nudge, 1000).stateIndex).toBe(5);
    // Audio agreeing with it is what actually moves the chart.
    let state = commitFollowEstimate(at(5), nudge, 1000);
    for (let i = 0; i < jumpHits; i++) {
      state = commitFollowEstimate(state, est(FAR), 1200 + i * 400);
    }
    expect(state.stateIndex).toBe(FAR);
  });

  it('returns the same object when nothing changed', () => {
    const state = at(5);
    expect(commitFollowEstimate(state, est(5), 1000)).toBe(state);
  });
});
