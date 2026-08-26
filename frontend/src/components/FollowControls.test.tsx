import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import FollowControls from './FollowControls';
import type { UseFollowResult } from '@/hooks/useFollow';
import type { FollowWarning } from '@/lib/followHealth';

function followStub(over: Partial<UseFollowResult> = {}): UseFollowResult {
  return {
    estimate: null,
    running: true,
    error: null,
    stage: null,
    warning: null,
    recording: false,
    recentWords: [],
    lastArbiter: null,
    start: vi.fn(),
    stop: vi.fn(),
    reposition: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    ...over,
  };
}

function renderControls(over: Partial<UseFollowResult> = {}, followOn = true, debug = false) {
  return render(
    <FollowControls
      follow={followStub(over)}
      followOn={followOn}
      paused={false}
      micSupported
      lyricStates={[]}
      debug={debug}
      onToggleFollow={vi.fn()}
      onResume={vi.fn()}
      saveState="idle"
      onSaveJson={vi.fn()}
    />,
  );
}

const NO_AUDIO: FollowWarning = {
  kind: 'no-audio',
  heading: 'Not getting any audio',
  message: 'Follow mode started but your browser never opened the microphone.',
  fatal: false,
};

const DENIED: FollowWarning = {
  kind: 'permission-denied',
  heading: 'Microphone access needed',
  message: 'Allow microphone access in your browser settings, then try again.',
  fatal: true,
};

describe('FollowControls', () => {
  it('says it is following, and only says so, when nothing is wrong', () => {
    renderControls();
    expect(screen.getByRole('button', { name: 'Follow mode: Following' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a silent failure instead of claiming to be following', () => {
    renderControls({ warning: NO_AUDIO });
    // The bug in #273 was this label staying "Following" over a dead chart.
    expect(screen.getByRole('button', { name: 'Follow mode: Not following' })).toBeInTheDocument();
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('Not getting any audio');
    expect(note).toHaveTextContent('never opened the microphone');
  });

  it('raises a fatal failure as an alert with the shared microphone wording', () => {
    renderControls({ warning: DENIED, error: { type: 'permission-denied' } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Microphone access needed');
    expect(alert).toHaveTextContent('Allow microphone access in your browser settings');
    // No raw error slug on screen any more.
    expect(screen.queryByText('permission-denied')).not.toBeInTheDocument();
  });

  it('hides the warning once Follow is switched off', () => {
    renderControls({ warning: NO_AUDIO }, false);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow mode: Follow' })).toBeInTheDocument();
  });
});

describe('FollowControls diagnostics panel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is not there at all for an account without Follow capture', () => {
    renderControls();
    expect(screen.queryByLabelText('Follow debug overlay')).not.toBeInTheDocument();
    expect(screen.queryByText('Follow · debug')).not.toBeInTheDocument();
  });

  it('stays closed until it is switched on', () => {
    // Turning capture on for an account says logs may be uploaded. It does not
    // ask for diagnostics parked over the bottom-right of every song. The switch
    // is an item in the chart actions menu, so there is nothing here to click.
    renderControls({}, true, true);

    expect(screen.queryByLabelText('Follow debug overlay')).not.toBeInTheDocument();
    expect(screen.queryByText('Follow · debug')).not.toBeInTheDocument();
  });

  it('shows the panel when the stored preference says so', () => {
    window.localStorage.setItem('porchsongs.followDebugHud', 'shown');
    renderControls({}, true, true);

    expect(screen.getByLabelText('Follow debug overlay')).toBeInTheDocument();
  });

  it('hides from its own header, and remembers, because it remounts every song', async () => {
    // Without the memory, someone who dismissed it would meet it again on the
    // next song of the set, and the one after that.
    const user = userEvent.setup();
    window.localStorage.setItem('porchsongs.followDebugHud', 'shown');
    const { unmount } = renderControls({}, true, true);

    await user.click(screen.getByRole('button', { name: 'Hide Follow debug panel' }));
    expect(screen.queryByLabelText('Follow debug overlay')).not.toBeInTheDocument();
    unmount();

    renderControls({}, true, true);
    expect(screen.queryByLabelText('Follow debug overlay')).not.toBeInTheDocument();
  });
});
