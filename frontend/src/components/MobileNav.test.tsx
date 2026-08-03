import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authState: 'ready',
    currentAuthUser: null,
    authConfig: { required: false },
    isPremium: false,
    handleLogout: vi.fn(),
  }),
}));

import MobileNav from '@/components/MobileNav';

describe('MobileNav', () => {
  it('renders hamburger menu button', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    const button = screen.getByRole('button', { name: /open navigation menu/i });
    expect(button).toBeInTheDocument();
  });

  it('opens sidebar when hamburger is clicked', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('highlights the active nav item based on route', () => {
    renderWithRouter(<MobileNav />, { route: '/app/library' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

    const libraryButton = screen.getByRole('button', { name: 'Library' });
    expect(libraryButton.className).toContain('text-primary');
    expect(libraryButton.className).toContain('font-semibold');
  });

  it('closes sidebar when a nav item is clicked', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    expect(screen.getByRole('button', { name: /close navigation menu/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));

    // The close button only exists while the sheet is mounted, so its absence is
    // the signal that the sheet closed. This used to assert on a visible
    // "Navigation" heading, which has been removed.
    expect(screen.queryByRole('button', { name: /close navigation menu/i })).not.toBeInTheDocument();
  });

  it('closes sidebar when close button is clicked', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    expect(screen.getByRole('button', { name: /close navigation menu/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close navigation menu/i }));

    expect(screen.queryByRole('button', { name: /close navigation menu/i })).not.toBeInTheDocument();
  });

  it('has no visible heading above the nav list', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

    // The sheet is opened by a hamburger and holds a list of links, so a
    // "Navigation" heading was labelling the self-evident and spending the
    // scarcest row on a phone screen.
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
    // The accessible name stays. Radix warns without a Dialog Title, and screen
    // reader users get no hamburger context.
    expect(screen.getByText('Navigation menu')).toHaveClass('sr-only');
  });

  it('shows footer links in sidebar when open', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

    expect(screen.getByText('Report issue')).toBeInTheDocument();
    expect(screen.getByText('Feature request')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'X (Twitter)' })).toBeInTheDocument();
  });

  it('Import nav item starts a fresh song via onNewSong and closes the sidebar', () => {
    const onNewSong = vi.fn();
    renderWithRouter(<MobileNav onNewSong={onNewSong} />, { route: '/app/library' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(onNewSong).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /close navigation menu/i })).not.toBeInTheDocument();
  });

  it('Import nav item falls back to navigation when no onNewSong is wired', () => {
    renderWithRouter(<MobileNav />, { route: '/app/library' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    // The item is always present (it is a tab); clicking it should not throw.
    const item = screen.getByRole('button', { name: 'Import' });
    fireEvent.click(item);
    expect(screen.queryByRole('button', { name: /close navigation menu/i })).not.toBeInTheDocument();
  });
});
