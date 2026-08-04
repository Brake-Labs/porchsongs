import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useFollow } from './useFollow';
import {
  createCannedSignal,
  scriptFromSong,
  type AdvanceSignal,
  type OnStage,
  type OnWords,
} from '@/lib/followSignal';
import { DEFAULT_FOLLOW_HEALTH } from '@/lib/followHealth';

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
].join('\n');

afterEach(() => {
  vi.useRealTimers();
});

describe('useFollow', () => {
  it('drives the tracker from a canned signal and advances the estimate', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(() => createCannedSignal(scriptFromSong(SONG, 2500)));
    });
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(result.current.running).toBe(true);
    expect(result.current.estimate?.stateIndex).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.estimate?.stateIndex).toBe(1);
    expect(result.current.recentWords).toContain('thinking');
  });

  it('records timed events and returns them as a recording', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFollow(SONG));

    act(() => result.current.startRecording());
    await act(async () => {
      await result.current.start(() => createCannedSignal(scriptFromSong(SONG, 1000)));
    });
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    let recording!: ReturnType<typeof result.current.stopRecording>;
    act(() => {
      recording = result.current.stopRecording();
    });
    expect(recording.songText).toBe(SONG);
    expect(recording.events.length).toBeGreaterThanOrEqual(3);
    expect(recording.events[0]!.at).toBe(0);
    expect(result.current.recording).toBe(false);
  });

  // A signal that reports an error still *resolves* its start() promise, so the
  // hook used to paint `running: true` straight over the top of the failure and
  // leave the errored signal referenced (and, on iOS, holding the mic).
  it('surfaces a signal error, stays not-running, and releases the signal', async () => {
    const stop = vi.fn();
    const failing: () => AdvanceSignal = () => ({
      start: (_onWords, onError) => {
        onError?.({ type: 'permission-denied' });
        return Promise.resolve();
      },
      stop,
    });
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(failing);
    });
    expect(result.current.error?.type).toBe('permission-denied');
    // A signal that failed during start() must not report itself as live, or
    // the toggle pulses "Following" over a chart that will never move.
    expect(result.current.running).toBe(false);
    expect(result.current.warning?.kind).toBe('permission-denied');
    expect(result.current.warning?.heading).toBe('Microphone access needed');
    // And the mic is released, or the captured iOS audio session deafens the tuner.
    expect(stop).toHaveBeenCalled();
  });

  it('clears the error and runs when a retry succeeds', async () => {
    let failNext = true;
    const makeSignal: () => AdvanceSignal = () => ({
      start: (_onWords, onError) => {
        if (failNext) onError?.({ type: 'permission-denied' });
        return Promise.resolve();
      },
      stop: () => {},
    });
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(makeSignal);
    });
    expect(result.current.running).toBe(false);

    // The user grants mic permission and taps again: a fresh start() succeeds.
    failNext = false;
    await act(async () => {
      await result.current.start(makeSignal);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.warning).toBeNull();
    expect(result.current.running).toBe(true);
  });

  it('repositions the tracker to a chosen line with high confidence', () => {
    const { result } = renderHook(() => useFollow(SONG));
    act(() => result.current.reposition(2));
    expect(result.current.estimate?.stateIndex).toBe(2);
    expect(result.current.estimate?.confidence).toBeGreaterThan(0.8);
  });

  it('consults the arbiter when sustained-ambiguous and applies its choice', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(3);
    // Five identical lines -> singing the shared words is ambiguous.
    const song = [
      '[A]', 'hello world', '[B]', 'hello world', '[C]', 'hello world',
      '[D]', 'hello world', '[E]', 'hello world',
    ].join('\n');
    const { result } = renderHook(() =>
      useFollow(song, { arbiter: { enabled: true, model: 'm', request, ambiguousMs: 400, cooldownMs: 0 } }),
    );
    const script = Array.from({ length: 10 }, (_, i) => ({ at: i * 700, words: ['hello', 'world'] }));

    await act(async () => {
      await result.current.start(() => createCannedSignal(script));
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(request).toHaveBeenCalled();
    const req = request.mock.calls[0]![0];
    expect(req.model).toBe('m');
    expect(req.candidates.length).toBeGreaterThan(0);
    expect(result.current.lastArbiter?.choice).toBe(3);
    expect(result.current.estimate?.stateIndex).toBe(3);
  });
});

/**
 * Issue #273: on an older iPad, Follow looked active and did nothing. The
 * recognizer never errors in that case, so the only evidence is what it fails
 * to do. These cover each way that can happen, and each way it must go quiet
 * again, because a warning that fires wrongly is worse than none.
 */
describe('useFollow health warnings', () => {
  const { audioMs, wordsMs, matchMs } = DEFAULT_FOLLOW_HEALTH;

  /** A signal the test drives by hand: it starts cleanly and then does nothing. */
  function manualSignal() {
    const hooks: { words?: OnWords; stage?: OnStage } = {};
    const factory: () => AdvanceSignal = () => ({
      start: (onWords, _onError, onStage) => {
        hooks.words = onWords;
        hooks.stage = onStage;
        return Promise.resolve();
      },
      stop: () => {},
    });
    return { factory, hooks };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('warns when the recognizer starts but never opens the microphone', async () => {
    const { factory } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    expect(result.current.running).toBe(true);
    expect(result.current.warning).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(audioMs - 1);
    });
    expect(result.current.warning).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.warning?.kind).toBe('no-audio');
  });

  it('clears the warning if capture starts late', async () => {
    const { factory, hooks } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    await act(async () => {
      vi.advanceTimersByTime(audioMs);
    });
    expect(result.current.warning?.kind).toBe('no-audio');

    await act(async () => {
      hooks.stage!('audio');
    });
    expect(result.current.warning).toBeNull();
  });

  it('blames the transcriber only when the recognizer confirms it heard sound', async () => {
    const { factory, hooks } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    await act(async () => {
      hooks.stage!('audio');
    });
    await act(async () => {
      vi.advanceTimersByTime(wordsMs);
    });
    // Capturing, but no evidence sound ever arrived: say nothing at all, because
    // this is what an intro looks like.
    expect(result.current.warning).toBeNull();

    await act(async () => {
      hooks.stage!('sound');
    });
    await act(async () => {
      vi.advanceTimersByTime(wordsMs);
    });
    // Now we know sound reached it, so we can name the real cause.
    expect(result.current.warning?.kind).toBe('no-transcript');
  });

  it('goes quiet as soon as words arrive, even with no capture milestones', async () => {
    const { factory, hooks } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    await act(async () => {
      vi.advanceTimersByTime(audioMs);
    });
    expect(result.current.warning?.kind).toBe('no-audio');

    await act(async () => {
      hooks.words!({ words: ['walking', 'down', 'the'], t: Date.now() });
    });
    expect(result.current.warning).toBeNull();
  });

  it('warns when words keep arriving but never fit the chart', async () => {
    const { factory, hooks } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        hooks.words!({ words: ['zebra', 'quantum', 'sprocket'], t: Date.now() });
        vi.advanceTimersByTime(matchMs / 12);
      });
    }
    expect(result.current.warning?.kind).toBe('no-match');
    expect(result.current.warning?.fatal).toBe(false);
  });

  it('never warns about matching once the chart has been followed', async () => {
    const { factory, hooks } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    // Real lyrics from two different lines: the tracker locks on.
    await act(async () => {
      hooks.words!({ words: ['walking', 'down', 'the', 'empty', 'road'], t: Date.now() });
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      hooks.words!({ words: ['thinking', 'of', 'the', 'words', 'you', 'said'], t: Date.now() });
    });
    await act(async () => {
      vi.advanceTimersByTime(matchMs * 3);
    });
    expect(result.current.warning).toBeNull();
  });

  it('drops any warning when Follow is switched off', async () => {
    const { factory } = manualSignal();
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(factory);
    });
    await act(async () => {
      vi.advanceTimersByTime(audioMs);
    });
    expect(result.current.warning?.kind).toBe('no-audio');

    act(() => result.current.stop());
    expect(result.current.warning).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(matchMs * 3);
    });
    expect(result.current.warning).toBeNull();
  });
});

/**
 * Ground truth in recordings.
 *
 * `FollowRecording.truth` was designed for "the line the performer said they were
 * on" and had no producer at all until tapping a line existed. It is what makes a
 * captured session scorable offline rather than merely replayable.
 */
describe('useFollow recording ground truth', () => {
  it('records a reposition as ground truth', () => {
    const { result } = renderHook(() => useFollow(SONG));
    act(() => result.current.startRecording());
    act(() => result.current.reposition(2));

    let rec: ReturnType<typeof result.current.stopRecording>;
    act(() => { rec = result.current.stopRecording(); });

    expect(rec!.truth).toHaveLength(1);
    // The rendered line, not the state index: a scorer compares against what was
    // on screen.
    expect(rec!.truth![0]!.renderIndex).toBeGreaterThanOrEqual(0);
    expect(rec!.truth![0]!.at).toBeGreaterThanOrEqual(0);
  });

  it('omits truth entirely when nothing was corrected', () => {
    // An empty array would claim ground truth was collected and happened to be
    // none, which a scorer would read as "the performer never disagreed".
    const { result } = renderHook(() => useFollow(SONG));
    act(() => result.current.startRecording());
    let rec: ReturnType<typeof result.current.stopRecording>;
    act(() => { rec = result.current.stopRecording(); });
    expect(rec!.truth).toBeUndefined();
  });

  it('does not record truth when no capture is running', () => {
    const { result } = renderHook(() => useFollow(SONG));
    act(() => result.current.reposition(1));
    act(() => result.current.startRecording());
    let rec: ReturnType<typeof result.current.stopRecording>;
    act(() => { rec = result.current.stopRecording(); });
    expect(rec!.truth).toBeUndefined();
  });

  it('stamps when the capture was taken', () => {
    const { result } = renderHook(() => useFollow(SONG));
    act(() => result.current.startRecording());
    let rec: ReturnType<typeof result.current.stopRecording>;
    act(() => { rec = result.current.stopRecording(); });
    expect(rec!.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
