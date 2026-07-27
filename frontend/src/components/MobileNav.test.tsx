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

    expect(screen.getByText('New Song')).toBeInTheDocument();
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
    expect(screen.getByText('Navigation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Library' }));

    // The sheet should close (Navigation header disappears)
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });

  it('closes sidebar when close button is clicked', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    expect(screen.getByText('Navigation')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close navigation menu/i }));

    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });

  it('shows footer links in sidebar when open', () => {
    renderWithRouter(<MobileNav />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));

    expect(screen.getByText('Report issue')).toBeInTheDocument();
    expect(screen.getByText('Feature request')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'X (Twitter)' })).toBeInTheDocument();
  });

  it('New Song nav item starts a fresh song via onNewSong and closes the sidebar', () => {
    const onNewSong = vi.fn();
    renderWithRouter(<MobileNav onNewSong={onNewSong} />, { route: '/app/library' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    fireEvent.click(screen.getByRole('button', { name: 'New Song' }));

    expect(onNewSong).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });

  it('New Song nav item falls back to navigation when no onNewSong is wired', () => {
    renderWithRouter(<MobileNav />, { route: '/app/library' });

    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    // The item is always present (it is a tab); clicking it should not throw.
    const item = screen.getByRole('button', { name: 'New Song' });
    fireEvent.click(item);
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
  });
});
