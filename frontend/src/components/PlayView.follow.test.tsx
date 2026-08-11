import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PerformanceSheet } from '@/components/PlayView';

const uploadMock = vi.hoisted(() => vi.fn<(r: unknown) => Promise<boolean>>());
const captureEnabledMock = vi.hoisted(() => vi.fn<() => boolean>(() => false));
vi.mock('@/extensions', async () => {
  const actual = await vi.importActual<typeof import('@/extensions')>('@/extensions');
  return { ...actual, uploadFollowLog: uploadMock, useFollowCaptureEnabled: captureEnabledMock };
});
import type { Song } from '@/types';

/**
 * Follow mode's mic lifecycle on the performance sheet.
 *
 * iOS Safari refuses the very first SpeechRecognition.start() while the mic
 * permission sheet is up and reports 'not-allowed'. Granting permission does not
 * retroactively start the recognizer, so the app has to be able to retry from a
 * fresh user gesture. Before this was fixed the sheet stayed stuck showing the
 * error and the only way back into Follow mode was reloading the app.
 */

/** A controllable stand-in for webkitSpeechRecognition. */
class MockRecognition {
  static instances: MockRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    MockRecognition.instances.push(this);
  }
  static get last(): MockRecognition {
    return MockRecognition.instances[MockRecognition.instances.length - 1]!;
  }
}

const win = window as unknown as Record<string, unknown>;

const SONG_TEXT = ['C            G', 'walking down the empty road', 'Am           F', 'thinking of the words you said'].join('\n');

function makeSong(): Song {
  return {
    id: 1,
    uuid: 'abc-123',
    profile_id: 1,
    title: 'Empty Road',
    artist: 'Nobody',
    original_content: SONG_TEXT,
    rewritten_content: SONG_TEXT,
    font_size: null,
    folder: null,
    status: 'draft',
  } as unknown as Song;
}

beforeEach(() => {
  MockRecognition.instances = [];
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  win.SpeechRecognition = MockRecognition;
  // jsdom has no layout, so the teleprompter's scroll call is a no-op here.
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  delete win.SpeechRecognition;
  delete win.webkitSpeechRecognition;
  vi.restoreAllMocks();
});

function followButton() {
  return screen.getByRole('button', { name: /^Follow mode:/ });
}

describe('PerformanceSheet follow mode', () => {
  it('recovers from a first-run mic denial on the next tap, with no reload', async () => {
    const user = userEvent.setup();
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);

    // First tap: iOS puts up the permission sheet and refuses this start().
    await user.click(followButton());
    expect(MockRecognition.instances).toHaveLength(1);
    const first = MockRecognition.last;
    expect(first.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.onerror!({ error: 'not-allowed' });
    });

    // The failure is visible, the mic is released, and Follow is back off, so
    // the very next tap is a start rather than a "turn it off".
    // Human copy, not the raw slug: the shared mic-error table now words this the
    // same way the tuner does. That it renders at all is the load-bearing part,
    // since the error switches Follow off and the card must outlive that.
    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone access needed');
    expect(first.abort).toHaveBeenCalled();
    expect(followButton()).toHaveAttribute('aria-pressed', 'false');

    // Second tap, after the user has granted permission: a brand new recognizer
    // starts from this gesture and the error clears.
    await user.click(followButton());
    expect(MockRecognition.instances).toHaveLength(2);
    expect(MockRecognition.last).not.toBe(first);
    expect(MockRecognition.last.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(followButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not respawn the recognizer after a fatal error', async () => {
    const user = userEvent.setup();
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);

    await user.click(followButton());
    const rec = MockRecognition.last;

    await act(async () => {
      rec.onerror!({ error: 'not-allowed' });
      // WebKit always follows an error with onend. That used to restart the
      // recognizer, spinning forever and keeping the iOS audio session captured
      // (which is what left the tuner unable to hear afterwards).
      rec.onend?.();
    });

    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(MockRecognition.instances).toHaveLength(1);
  });
});

/**
 * Tap-to-reposition.
 *
 * Follow guesses from audio and sometimes guesses wrong, most often on a repeated
 * chorus where two positions are genuinely indistinguishable. The tracker could
 * always be told the answer, but nothing in the UI called `reposition`, so the only
 * way to correct a wrong lock was to stop and restart Follow.
 *
 * SONG_TEXT lines: 0 chord, 1 lyric, 2 chord, 3 lyric. So the lyric states are
 * render indices 1 and 3.
 */
describe('PerformanceSheet tap to reposition', () => {
  const line = (i: number) => document.querySelector(`[data-line="${i}"]`) as HTMLElement;
  const isHighlighted = (i: number) => !!line(i)?.style.background;

  async function followOn(user: ReturnType<typeof userEvent.setup>) {
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);
    await user.click(followButton());
    expect(followButton()).toHaveAttribute('aria-pressed', 'true');
  }

  it('moves the highlight to a tapped lyric line', async () => {
    const user = userEvent.setup();
    await followOn(user);
    // Nothing has been heard yet, so nothing is locked.
    expect(isHighlighted(3)).toBe(false);

    await user.click(line(3));

    expect(isHighlighted(3)).toBe(true);
  });

  it('treats a tap on a chord row as the lyric it sits above', async () => {
    // Chord lines are not tracker states. Snapping backwards would jump the singer
    // to the previous verse, so the tap resolves forward to the line it labels.
    const user = userEvent.setup();
    await followOn(user);

    await user.click(line(2));

    expect(isHighlighted(3)).toBe(true);
    expect(isHighlighted(1)).toBe(false);
  });

  it('centres the page again even when the tapped line is already the target', async () => {
    // The dead zone means the follow-along effect ignores a line it already
    // considers centred, so this tap has to force the scroll or it does nothing.
    const user = userEvent.setup();
    await followOn(user);
    await user.click(line(3));
    const scrollTo = Element.prototype.scrollTo as ReturnType<typeof vi.fn>;
    scrollTo.mockClear();

    await user.click(line(3));

    expect(scrollTo).toHaveBeenCalled();
  });

  it('renders no tappable lines while Follow is off, so reading a chart is inert', async () => {
    // This is the real mechanism, and worth asserting rather than assuming: with
    // Follow off the sheet is one block of text with no per-line spans and no click
    // handler, so a stray tap cannot move anything. Asserting only that a click did
    // nothing would pass even if the guard were deleted.
    const user = userEvent.setup();
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);
    const scrollTo = Element.prototype.scrollTo as ReturnType<typeof vi.fn>;
    scrollTo.mockClear();

    expect(document.querySelectorAll('[data-line]')).toHaveLength(0);

    const pre = document.querySelector('pre') as HTMLElement;
    await user.click(pre);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('renders tappable lines once Follow is on', async () => {
    const user = userEvent.setup();
    await followOn(user);
    expect(document.querySelectorAll('[data-line]').length).toBeGreaterThan(0);
  });

  it('says what a tap does, since the affordance is otherwise invisible', async () => {
    const user = userEvent.setup();
    await followOn(user);
    expect(screen.getByLabelText(/Tap a line to move Follow to it/)).toBeInTheDocument();
  });
});

/**
 * Saving a capture.
 *
 * The sessions worth diagnosing happen on a phone, usually an installed PWA, where
 * a downloaded JSON file is not something anyone gets onto a laptop. So the save
 * uploads when a store exists and downloads only as a fallback, and it says which
 * happened, because whether it left the device is the one part the person holding
 * the phone cannot check.
 */
describe('PerformanceSheet saving a capture', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    uploadMock.mockReset();
    captureEnabledMock.mockReturnValue(true);
    // jsdom implements neither, and the download path needs both.
    URL.createObjectURL = vi.fn(() => 'blob:stub');
    URL.revokeObjectURL = vi.fn();
    // The anchor click IS the download, so it is what a test must observe. The
    // status label alone is set either way and would pass with no download at all.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  async function recordThenSave() {
    const user = userEvent.setup();
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);
    await user.click(screen.getByRole('button', { name: 'Record' }));
    await user.click(screen.getByRole('button', { name: /Save logs/ }));
    return user;
  }

  it('uploads the capture when a store is available', async () => {
    uploadMock.mockResolvedValue(true);
    await recordThenSave();
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved to server')).toBeInTheDocument();
    // And no file is dumped on the phone when the upload succeeded.
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('falls back to a download when there is no store', async () => {
    uploadMock.mockResolvedValue(false);
    await recordThenSave();
    expect(await screen.findByText('Downloaded to this device')).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to a download when the upload throws', async () => {
    // A failed upload must not cost the capture.
    uploadMock.mockRejectedValue(new Error('offline'));
    await recordThenSave();
    expect(await screen.findByText('Downloaded to this device')).toBeInTheDocument();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('sends the recording itself, so it can be replayed offline', async () => {
    uploadMock.mockResolvedValue(true);
    await recordThenSave();
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    const payload = uploadMock.mock.calls[0]![0] as { songText: string; events: unknown[] };
    expect(payload.songText).toContain('walking down the empty road');
    expect(Array.isArray(payload.events)).toBe(true);
  });
});

/**
 * The capture controls are gated on the account and nothing else.
 *
 * They used to also be reachable with `?followdebug`, which armed a flag in that
 * browser's localStorage. Two ways in is one too many for an operator tool whose
 * captures carry the performer's song text and transcript, and the device route was
 * the useless one: the sessions worth capturing happen on a phone running the
 * installed app, where `start_url` is fixed and there is no address bar to put a
 * query string in. So the account is now the only switch.
 */
describe('PerformanceSheet capture controls gating', () => {
  beforeEach(() => {
    captureEnabledMock.mockReturnValue(false);
  });

  it('hides the capture controls when the account has not enabled them', () => {
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
  });

  it('shows them when the account has capture enabled', () => {
    captureEnabledMock.mockReturnValue(true);
    render(<PerformanceSheet song={makeSong()} version="rewritten" />);
    expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
  });

  it('ignores a query string, so an old ?followdebug link grants nothing', () => {
    // The param is gone, not merely undocumented. A link someone saved must not be a
    // way around the account setting.
    window.history.replaceState(null, '', '/app/play/1?followdebug');
    try {
      render(<PerformanceSheet song={makeSong()} version="rewritten" />);
      expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
