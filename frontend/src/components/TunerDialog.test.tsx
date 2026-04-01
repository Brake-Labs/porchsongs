import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/test-utils';
import Header from '@/components/Header';
import TunerDialog from '@/components/TunerDialog';

// Mock useTuner
const mockStart = vi.fn();
const mockStop = vi.fn();

interface MockTunerState {
  status: 'idle' | 'listening' | 'error';
  note: string | null;
  octave: number | null;
  cents: number;
  frequency: number | null;
  tuningStatus: 'intune' | 'close' | 'off' | 'idle';
  errorType: 'permission-denied' | 'not-found' | 'unsupported' | 'insecure-context' | null;
  start: () => void;
  stop: () => void;
}

const defaultTunerState: MockTunerState = {
  status: 'idle',
  note: null,
  octave: null,
  cents: 0,
  frequency: null,
  tuningStatus: 'idle',
  errorType: null,
  start: mockStart,
  stop: mockStop,
};

let tunerState: MockTunerState = { ...defaultTunerState };

vi.mock('@/hooks/useTuner', () => ({
  default: () => tunerState,
}));

describe('TunerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tunerState = { ...defaultTunerState, start: mockStart, stop: mockStop };
  });

  it('renders tuner button in header with correct aria-label', () => {
    renderWithRouter(
      <Header user={null} authRequired={false} onLogout={vi.fn()} />
    );
    expect(screen.getByLabelText('Open tuner')).toBeInTheDocument();
  });

  it('opens dialog on button click', async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <Header user={null} authRequired={false} onLogout={vi.fn()} />
    );
    await user.click(screen.getByLabelText('Open tuner'));
    expect(screen.getByText('Tuner')).toBeInTheDocument();
  });

  it('shows "Play a note..." when listening but no pitch detected', () => {
    tunerState = { ...tunerState, status: 'listening' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Play a note...')).toBeInTheDocument();
  });

  it('shows listening indicator when active', () => {
    tunerState = { ...tunerState, status: 'listening' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Listening...')).toBeInTheDocument();
  });

  it('displays note name and cents when pitch detected', () => {
    tunerState = {
      ...tunerState,
      status: 'listening',
      note: 'E',
      octave: 4,
      cents: 8,
      frequency: 330,
      tuningStatus: 'close',
    };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('+8 cents')).toBeInTheDocument();
  });

  it('shows "--" when no note is detected', () => {
    tunerState = { ...tunerState, status: 'listening' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('--')).toBeInTheDocument();
  });

  it('shows permission error state with Try Again button', () => {
    tunerState = { ...tunerState, status: 'error', errorType: 'permission-denied' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Microphone access needed')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('shows not-found error state', () => {
    tunerState = { ...tunerState, status: 'error', errorType: 'not-found' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('No microphone detected')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('shows unsupported browser error without retry', () => {
    tunerState = { ...tunerState, status: 'error', errorType: 'unsupported' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Browser not supported')).toBeInTheDocument();
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
  });

  it('shows insecure context error without retry', () => {
    tunerState = { ...tunerState, status: 'error', errorType: 'insecure-context' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText('Secure connection required')).toBeInTheDocument();
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
  });

  it('Try Again button calls start', async () => {
    const user = userEvent.setup();
    tunerState = { ...tunerState, status: 'error', errorType: 'permission-denied' };
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    await user.click(screen.getByText('Try Again'));
    expect(mockStart).toHaveBeenCalled();
  });

  it('renders close button with aria-label', () => {
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText('Close tuner')).toBeInTheDocument();
  });

  it('closes dialog when close button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<TunerDialog open={true} onOpenChange={onOpenChange} />);
    await user.click(screen.getByLabelText('Close tuner'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls start when dialog opens', () => {
    render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    expect(mockStart).toHaveBeenCalled();
  });

  it('calls stop when dialog closes', () => {
    const { rerender } = render(<TunerDialog open={true} onOpenChange={vi.fn()} />);
    rerender(<TunerDialog open={false} onOpenChange={vi.fn()} />);
    expect(mockStop).toHaveBeenCalled();
  });
});
