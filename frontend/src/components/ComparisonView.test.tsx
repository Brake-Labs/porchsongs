import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ComparisonView from '@/components/ComparisonView';

describe('ComparisonView', () => {
  const defaults = {
    rewritten: 'Rewritten content here',
    onRewrittenChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the rewritten content in a textarea', () => {
    render(<ComparisonView {...defaults} />);
    const textarea = screen.getByDisplayValue('Rewritten content here');
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName).toBe('TEXTAREA');
  });

  it('shows "Your Version" header when no headerLeft provided', () => {
    render(<ComparisonView {...defaults} />);
    expect(screen.getByText('Your Version')).toBeInTheDocument();
  });

  it('renders headerLeft content instead of "Your Version" when provided', () => {
    render(<ComparisonView {...defaults} headerLeft={<span>Custom Header</span>} />);
    expect(screen.getByText('Custom Header')).toBeInTheDocument();
    expect(screen.queryByText('Your Version')).not.toBeInTheDocument();
  });

  it('renders Show Original button when onShowOriginal is provided', () => {
    const onShowOriginal = vi.fn();
    render(<ComparisonView {...defaults} onShowOriginal={onShowOriginal} />);
    expect(screen.getByRole('button', { name: 'Show Original' })).toBeInTheDocument();
  });

  it('does not render Show Original button when onShowOriginal is omitted', () => {
    render(<ComparisonView {...defaults} />);
    expect(screen.queryByRole('button', { name: 'Show Original' })).not.toBeInTheDocument();
  });

  it('calls onShowOriginal when the button is clicked', async () => {
    const user = userEvent.setup();
    const onShowOriginal = vi.fn();
    render(<ComparisonView {...defaults} onShowOriginal={onShowOriginal} />);
    await user.click(screen.getByRole('button', { name: 'Show Original' }));
    expect(onShowOriginal).toHaveBeenCalledTimes(1);
  });

  it('textarea background does not change on focus', () => {
    render(<ComparisonView {...defaults} />);
    const textarea = screen.getByDisplayValue('Rewritten content here');
    expect(textarea.className).not.toContain('focus:bg-focus-bg');
  });

  it('calls onRewrittenChange when textarea content changes', async () => {
    const user = userEvent.setup();
    render(<ComparisonView {...defaults} />);
    const textarea = screen.getByDisplayValue('Rewritten content here');
    await user.type(textarea, '!');
    expect(defaults.onRewrittenChange).toHaveBeenCalled();
  });
});
