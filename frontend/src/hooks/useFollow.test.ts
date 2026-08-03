import { renderHook, act } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { useFollow } from './useFollow';
import {
  createCannedSignal,
  scriptFromSong,
  type AdvanceSignal,
} from '@/lib/followSignal';

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
    expect(result.current.running).toBe(false);
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
