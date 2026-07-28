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

  it('surfaces a signal error and stays not-running', async () => {
    const failing: () => AdvanceSignal = () => ({
      start: (_onWords, onError) => {
        onError?.({ type: 'permission-denied' });
        return Promise.resolve();
      },
      stop: () => {},
    });
    const { result } = renderHook(() => useFollow(SONG));

    await act(async () => {
      await result.current.start(failing);
    });
    expect(result.current.error?.type).toBe('permission-denied');
  });

  it('repositions the tracker to a chosen line with high confidence', () => {
    const { result } = renderHook(() => useFollow(SONG));
    act(() => result.current.reposition(2));
    expect(result.current.estimate?.stateIndex).toBe(2);
    expect(result.current.estimate?.confidence).toBeGreaterThan(0.8);
  });
});
