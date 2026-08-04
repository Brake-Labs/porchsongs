import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import FollowControls from './FollowControls';
import type { UseFollowResult } from '@/hooks/useFollow';
import type { FollowWarning } from '@/lib/followHealth';

function followStub(over: Partial<UseFollowResult> = {}): UseFollowResult {
  return {
    estimate: null,
    running: true,
    error: null,
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

function renderControls(over: Partial<UseFollowResult> = {}, followOn = true) {
  return render(
    <FollowControls
      follow={followStub(over)}
      followOn={followOn}
      paused={false}
      micSupported
      lyricStates={[]}
      debug={false}
      onToggleFollow={vi.fn()}
      onResume={vi.fn()}
      saveState="idle"
      onDemo={vi.fn()}
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
