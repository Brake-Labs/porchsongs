import { render, screen } from '@testing-library/react';
import TunerGauge from '@/components/TunerGauge';

describe('TunerGauge', () => {
  it('renders SVG with correct role and aria attributes', () => {
    render(<TunerGauge cents={0} status="idle" />);
    const gauge = screen.getByRole('meter');
    expect(gauge).toBeInTheDocument();
    expect(gauge).toHaveAttribute('aria-valuenow', '0');
    expect(gauge).toHaveAttribute('aria-valuemin', '-50');
    expect(gauge).toHaveAttribute('aria-valuemax', '50');
    expect(gauge).toHaveAttribute('aria-label', 'Tuning gauge');
  });

  it('renders SVG with correct viewBox', () => {
    render(<TunerGauge cents={0} status="idle" />);
    const gauge = screen.getByRole('meter');
    expect(gauge).toHaveAttribute('viewBox', '0 0 240 130');
  });

  it('updates aria-valuenow with cents prop', () => {
    const { rerender } = render(<TunerGauge cents={-25} status="close" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '-25');

    rerender(<TunerGauge cents={30} status="off" />);
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '30');
  });

  it('renders arc path segments', () => {
    const { container } = render(<TunerGauge cents={0} status="intune" />);
    // Should have 5 arc path segments (coral, amber, sage, amber, coral)
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(5);
  });

  it('renders tick marks', () => {
    const { container } = render(<TunerGauge cents={0} status="idle" />);
    // 5 tick marks + 1 needle line = 6 line elements
    const lines = container.querySelectorAll('line');
    expect(lines.length).toBe(6);
  });

  it('renders pivot circle', () => {
    const { container } = render(<TunerGauge cents={0} status="idle" />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(1);
  });

  it('dims gauge when idle', () => {
    const { container } = render(<TunerGauge cents={0} status="idle" />);
    const paths = container.querySelectorAll('path');
    paths.forEach(path => {
      expect(path.getAttribute('opacity')).toBe('0.4');
    });
  });

  it('shows full opacity when active', () => {
    const { container } = render(<TunerGauge cents={10} status="close" />);
    const paths = container.querySelectorAll('path');
    paths.forEach(path => {
      expect(path.getAttribute('opacity')).toBe('1');
    });
  });
});
