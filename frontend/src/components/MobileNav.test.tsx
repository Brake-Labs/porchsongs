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

    expect(screen.getByText('Rewrite')).toBeInTheDocument();
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
});
