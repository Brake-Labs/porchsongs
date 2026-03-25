import { render, screen } from '@testing-library/react';
import { UsageFooter } from '@/extensions/quota';

describe('UsageFooter', () => {
  it('renders nothing when both input_tokens and output_tokens are 0', () => {
    const { container } = render(
      <UsageFooter tokenUsage={{ input_tokens: 0, output_tokens: 0 }} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders total token count when tokens > 0', () => {
    render(
      <UsageFooter tokenUsage={{ input_tokens: 800, output_tokens: 200 }} />,
    );
    expect(screen.getByText('Tokens used: 1,000')).toBeInTheDocument();
  });

  it('shows input/output breakdown', () => {
    render(
      <UsageFooter tokenUsage={{ input_tokens: 800, output_tokens: 200 }} />,
    );
    expect(screen.getByText('800 in / 200 out')).toBeInTheDocument();
  });

  it('displays formatted numbers with locale separators', () => {
    render(
      <UsageFooter tokenUsage={{ input_tokens: 10000, output_tokens: 2345 }} />,
    );
    expect(screen.getByText('Tokens used: 12,345')).toBeInTheDocument();
    expect(screen.getByText('10,000 in / 2,345 out')).toBeInTheDocument();
  });

  it('has aria-live="polite" for accessibility', () => {
    render(
      <UsageFooter tokenUsage={{ input_tokens: 100, output_tokens: 50 }} />,
    );
    const footer = screen.getByText('Tokens used: 150').closest('div');
    expect(footer).toHaveAttribute('aria-live', 'polite');
  });

  it('renders when only input_tokens > 0', () => {
    render(
      <UsageFooter tokenUsage={{ input_tokens: 500, output_tokens: 0 }} />,
    );
    expect(screen.getByText('Tokens used: 500')).toBeInTheDocument();
  });
});
