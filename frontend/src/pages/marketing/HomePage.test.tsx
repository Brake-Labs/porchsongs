import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import HomePage from '@/pages/marketing/HomePage';

describe('HomePage', () => {
  it('renders the hero heading and subtext', () => {
    renderWithRouter(<HomePage />);
    expect(screen.getByText('Your chord charts, ready to play')).toBeInTheDocument();
    expect(screen.getByText(/whatever screen is on the music stand/)).toBeInTheDocument();
    expect(screen.getByText(/text big enough to read from across the room/)).toBeInTheDocument();
  });

  it('renders how-it-works feature cards', () => {
    renderWithRouter(<HomePage />);
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByText('Bring Charts In')).toBeInTheDocument();
    expect(screen.getByText('Play From Anywhere')).toBeInTheDocument();
    expect(screen.getByText('Your Songbook')).toBeInTheDocument();
  });

  it('renders CTA links', () => {
    renderWithRouter(<HomePage />);
    expect(screen.getByText('Get Started Free')).toBeInTheDocument();
    expect(screen.getByText('View Pricing')).toBeInTheDocument();
  });

  it('renders demo video', () => {
    renderWithRouter(<HomePage />);
    const video = document.querySelector('video[aria-label="porchsongs demo"]');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('src', '/porchsongs-demo.mp4');
  });
});
