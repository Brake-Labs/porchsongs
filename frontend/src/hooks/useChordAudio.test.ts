import { act, renderHook } from '@testing-library/react';
import useChordAudio from './useChordAudio';

/**
 * jsdom has no Web Audio, which is the first thing this hook has to survive:
 * without the guard the page would throw on any browser or context where
 * AudioContext is missing, and "Hear it" is a nicety, not the feature.
 *
 * The rest is checked against a stub context, since the only observable
 * behaviour worth asserting is what gets scheduled.
 */

interface StubOscillator {
  type: string;
  frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

interface StubGain {
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

interface Stub {
  oscillators: StubOscillator[];
  gains: StubGain[];
  closed: boolean;
  resumed: number;
}

function installStubAudio(): Stub {
  const stub: Stub = { oscillators: [], gains: [], closed: false, resumed: 0 };

  class StubAudioContext {
    currentTime = 0;
    destination = {};
    createOscillator() {
      const oscillator: StubOscillator = {
        type: '',
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      stub.oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      const gain: StubGain = {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          cancelScheduledValues: vi.fn(),
        },
        connect: vi.fn(),
      };
      stub.gains.push(gain);
      return gain;
    }
    resume() {
      stub.resumed++;
      return Promise.resolve();
    }
    close() {
      stub.closed = true;
      return Promise.resolve();
    }
  }

  vi.stubGlobal('AudioContext', StubAudioContext);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('without Web Audio', () => {
  it('reports itself unsupported and does nothing when played', () => {
    const { result } = renderHook(() => useChordAudio());
    expect(result.current.supported).toBe(false);
    expect(() => result.current.play([60, 64, 67])).not.toThrow();
    expect(result.current.playing).toBe(false);
  });
});

describe('with Web Audio', () => {
  it('schedules one oscillator per harmonic of each note', () => {
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());
    expect(result.current.supported).toBe(true);

    act(() => result.current.play([60, 64, 67]));
    expect(stub.oscillators.length % 3).toBe(0);
    expect(stub.oscillators.length).toBeGreaterThanOrEqual(9);
  });

  it('staggers the notes so the chord is strummed rather than struck', () => {
    // A block chord sounds like an organ and hides a wrong note in the middle
    // of the voicing. Hearing the strings arrive one by one is the point.
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());

    act(() => result.current.play([60, 64, 67]));
    const starts = stub.oscillators.map(o => o.start.mock.calls[0]![0] as number);
    expect(new Set(starts).size).toBeGreaterThan(1);
    expect(Math.max(...starts)).toBeGreaterThan(Math.min(...starts));
  });

  it('tunes each note to its own pitch', () => {
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());

    act(() => result.current.play([69])); // A440
    const fundamentals = stub.oscillators.map(o => o.frequency.setValueAtTime.mock.calls[0]![0] as number);
    expect(fundamentals).toContain(440);
    // Plus its harmonics, which is what stops it sounding like a test tone.
    expect(fundamentals).toContain(880);
  });

  it('resumes the context, because a fresh one starts suspended', () => {
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());
    act(() => result.current.play([60]));
    expect(stub.resumed).toBeGreaterThan(0);
  });

  it('reports playing until the strum has rung out', () => {
    vi.useFakeTimers();
    installStubAudio();
    const { result } = renderHook(() => useChordAudio());

    act(() => result.current.play([60, 64, 67]));
    expect(result.current.playing).toBe(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.playing).toBe(false);
  });

  it('fades a running strum out rather than cutting it, which clicks', () => {
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());

    act(() => result.current.play([60, 64, 67]));
    const master = stub.gains[0]!;
    act(() => result.current.stop());
    expect(master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    expect(result.current.playing).toBe(false);
  });

  it('does not stack strums on top of each other', () => {
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());

    act(() => result.current.play([60]));
    const first = stub.gains[0]!;
    act(() => result.current.play([62]));
    expect(first.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it('ignores an empty chord', () => {
    const stub = installStubAudio();
    const { result } = renderHook(() => useChordAudio());
    act(() => result.current.play([]));
    expect(stub.oscillators).toHaveLength(0);
  });

  it('closes the context when the page goes away', () => {
    const stub = installStubAudio();
    const { result, unmount } = renderHook(() => useChordAudio());
    act(() => result.current.play([60]));
    unmount();
    expect(stub.closed).toBe(true);
  });
});
