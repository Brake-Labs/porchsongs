import { render, screen } from '@testing-library/react';
import MidiDialog from '@/components/MidiDialog';
import type { LlmSettings, SavedModel } from '@/types';

// Mock abcjs (needs browser APIs unavailable in jsdom)
vi.mock('abcjs', () => ({
  default: {
    renderAbc: vi.fn(() => [{}]),
    synth: {
      SynthController: vi.fn(),
      CreateSynth: vi.fn(),
    },
  },
  renderAbc: vi.fn(() => [{}]),
  synth: {
    SynthController: vi.fn(),
    CreateSynth: vi.fn(),
  },
}));

// Mock api module
vi.mock('@/api', () => ({
  default: {
    abcStream: vi.fn(),
  },
  STORAGE_KEYS: {
    ABC_PROVIDER: 'porchsongs_abc_provider',
    ABC_MODEL: 'porchsongs_abc_model',
  },
}));

// Mock extensions
vi.mock('@/extensions/settings', () => ({
  shouldShowAbcModelSelector: vi.fn(() => true),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  songContent: 'G  Am\nHello world',
  songTitle: 'Test Song',
  songArtist: 'Test Artist',
  profileId: 1,
  llmSettings: { provider: 'openai', model: 'gpt-4o', reasoning_effort: '' } as LlmSettings,
  savedModels: [
    { id: 1, profile_id: 1, provider: 'openai', model: 'gpt-4o', api_base: null, created_at: '' },
  ] as SavedModel[],
  isPremium: false,
  isAdmin: false,
};

describe('MidiDialog', () => {
  it('renders dialog title when open', () => {
    render(<MidiDialog {...defaultProps} />);
    expect(screen.getByText('Sheet Music: Test Song')).toBeInTheDocument();
  });

  it('shows Generate button in idle state', () => {
    render(<MidiDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Generate Sheet Music' })).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(<MidiDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Sheet Music: Test Song')).not.toBeInTheDocument();
  });

  it('renders model selector when showAbcModelSelector returns true', () => {
    render(<MidiDialog {...defaultProps} />);
    // Provider dropdown should be present with the provider option
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('shows Close button', () => {
    render(<MidiDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
