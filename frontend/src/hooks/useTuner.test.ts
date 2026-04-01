import { renderHook, act } from '@testing-library/react';
import useTuner from '@/hooks/useTuner';

// Mock pitchy
const mockFindPitch = vi.fn().mockReturnValue([0, 0]);
vi.mock('pitchy', () => ({
  PitchDetector: {
    forFloat32Array: () => ({ findPitch: mockFindPitch }),
  },
}));

// Mock AudioContext and AnalyserNode
const mockGetFloatTimeDomainData = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockStopTrack = vi.fn();

function createMockAudioContext() {
  return {
    sampleRate: 44100,
    createMediaStreamSource: () => ({ connect: mockConnect }),
    createAnalyser: () => ({
      fftSize: 2048,
      getFloatTimeDomainData: mockGetFloatTimeDomainData,
    }),
    close: mockClose,
  };
}

function createMockStream() {
  return {
    getTracks: () => [{ stop: mockStopTrack }],
  };
}

let rafCallbacks: Array<() => void> = [];
let rafId = 1;

beforeEach(() => {
  vi.clearAllMocks();
  rafCallbacks = [];
  rafId = 1;
  mockFindPitch.mockReturnValue([0, 0]);

  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb as () => void);
    return rafId++;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

  // jsdom doesn't set isSecureContext to true by default
  Object.defineProperty(window, 'isSecureContext', {
    value: true,
    configurable: true,
    writable: true,
  });

  // Default: getUserMedia available
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue(createMockStream()),
    },
    configurable: true,
    writable: true,
  });

  vi.stubGlobal('AudioContext', vi.fn().mockImplementation(createMockAudioContext));
});

function flushRaf() {
  const cbs = [...rafCallbacks];
  rafCallbacks = [];
  cbs.forEach(cb => cb());
}

describe('useTuner', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useTuner());
    expect(result.current.status).toBe('idle');
    expect(result.current.note).toBeNull();
    expect(result.current.errorType).toBeNull();
  });

  it('starts listening on start()', async () => {
    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('listening');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('returns permission-denied on NotAllowedError', async () => {
    const err = new DOMException('Not allowed', 'NotAllowedError');
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.errorType).toBe('permission-denied');
  });

  it('returns not-found on NotFoundError', async () => {
    const err = new DOMException('Not found', 'NotFoundError');
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.errorType).toBe('not-found');
  });

  it('returns insecure-context when not in a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.errorType).toBe('insecure-context');

    // Restore
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
      writable: true,
    });
  });

  it('returns unsupported when getUserMedia is not available', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.errorType).toBe('unsupported');
  });

  it('detects pitch and returns note/octave/cents', async () => {
    // A4 = 440Hz with high clarity
    mockFindPitch.mockReturnValue([440, 0.98]);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });

    // Run rAF loop 3 times to fill smoothing buffer
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });

    expect(result.current.note).toBe('A');
    expect(result.current.octave).toBe(4);
    expect(result.current.cents).toBe(0);
  });

  it('does not detect note with low clarity', async () => {
    mockFindPitch.mockReturnValue([440, 0.5]);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    act(() => { flushRaf(); });

    expect(result.current.note).toBeNull();
    expect(result.current.tuningStatus).toBe('idle');
  });

  it('reports intune when cents < 5', async () => {
    // 440Hz = exactly A4, cents should be 0
    mockFindPitch.mockReturnValue([440, 0.98]);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });

    expect(result.current.tuningStatus).toBe('intune');
  });

  it('reports close when cents 5-25', async () => {
    // ~453Hz is about 50 cents sharp of A4, try something closer
    // 10 cents sharp of A4: 440 * 2^(10/1200) ≈ 442.55
    mockFindPitch.mockReturnValue([442.55, 0.98]);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });

    expect(result.current.tuningStatus).toBe('close');
  });

  it('reports off when cents > 25', async () => {
    // 30 cents sharp: 440 * 2^(30/1200) ≈ 447.69
    mockFindPitch.mockReturnValue([447.69, 0.98]);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });

    expect(result.current.tuningStatus).toBe('off');
  });

  it('does not update state when note and cents are unchanged', async () => {
    mockFindPitch.mockReturnValue([440, 0.98]);

    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });

    // Fill the buffer
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });

    // State should have been set
    expect(result.current.note).toBe('A');

    // One more tick with same values: the state-change guard skips setState
    const prevFreq = result.current.frequency;
    act(() => { flushRaf(); });
    expect(result.current.frequency).toBe(prevFreq);
  });

  it('averages last 3 readings for smoothing', async () => {
    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });

    // Feed 3 slightly different frequencies
    mockFindPitch.mockReturnValueOnce([438, 0.98]);
    act(() => { flushRaf(); });
    mockFindPitch.mockReturnValueOnce([440, 0.98]);
    act(() => { flushRaf(); });
    mockFindPitch.mockReturnValueOnce([442, 0.98]);
    act(() => { flushRaf(); });

    // Average of 438, 440, 442 = 440, which is A4
    expect(result.current.note).toBe('A');
    expect(result.current.octave).toBe(4);
  });

  it('holds note briefly after clarity drops then clears', async () => {
    vi.useFakeTimers();

    // Detect a note first
    mockFindPitch.mockReturnValue([440, 0.98]);
    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    expect(result.current.note).toBe('A');

    // Now clarity drops
    mockFindPitch.mockReturnValue([440, 0.5]);
    act(() => { flushRaf(); });

    // Note should still be held
    expect(result.current.note).toBe('A');

    // After the hold timer expires, note clears
    act(() => { vi.advanceTimersByTime(700); });
    expect(result.current.note).toBeNull();
    expect(result.current.tuningStatus).toBe('idle');

    vi.useRealTimers();
  });

  it('cancels note hold when good pitch returns', async () => {
    vi.useFakeTimers();

    // Detect a note
    mockFindPitch.mockReturnValue([440, 0.98]);
    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    expect(result.current.note).toBe('A');

    // Clarity drops briefly
    mockFindPitch.mockReturnValue([440, 0.5]);
    act(() => { flushRaf(); });
    expect(result.current.note).toBe('A');

    // Good pitch returns before hold expires
    mockFindPitch.mockReturnValue([330, 0.98]);
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });
    act(() => { flushRaf(); });

    // Should show the new note, not clear
    expect(result.current.note).toBe('E');

    // Even after the original hold timer would have fired, note persists
    act(() => { vi.advanceTimersByTime(700); });
    expect(result.current.note).toBe('E');

    vi.useRealTimers();
  });

  it('cleans up on stop()', async () => {
    const { result } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.status).toBe('listening');

    act(() => {
      result.current.stop();
    });

    expect(result.current.status).toBe('idle');
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(mockStopTrack).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it('cleans up on unmount', async () => {
    const { result, unmount } = renderHook(() => useTuner());
    await act(async () => {
      await result.current.start();
    });

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(mockStopTrack).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });
});
