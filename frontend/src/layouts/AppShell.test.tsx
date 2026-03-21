import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';

// Mock auth context: ready state with no auth required
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authState: 'ready',
    currentAuthUser: null,
    authConfig: { required: false },
    isPremium: false,
    handleLogout: vi.fn(),
  }),
}));

// Mock api module
vi.mock('@/api', () => ({
  default: {
    listProfiles: vi.fn().mockResolvedValue([{ id: 1, is_default: true }]),
  },
  STORAGE_KEYS: {
    PROVIDER: 'test_provider',
    MODEL: 'test_model',
    REASONING_EFFORT: 'test_effort',
    CURRENT_SONG_ID: 'test_song_id',
  },
}));

// Mock hooks that call the backend
vi.mock('@/hooks/useProviderConnections', () => ({
  default: () => ({ connections: [], addConnection: vi.fn(), removeConnection: vi.fn() }),
}));
vi.mock('@/hooks/useSavedModels', () => ({
  default: () => ({ savedModels: [], addModel: vi.fn(), removeModel: vi.fn(), refresh: vi.fn() }),
}));

// Stub heavy children so the test focuses on layout structure
vi.mock('@/components/Header', () => ({
  default: () => <div data-testid="header">Header</div>,
}));
vi.mock('@/components/Tabs', () => ({
  default: () => <div data-testid="tabs">Tabs</div>,
}));
vi.mock('@/components/MobileNav', () => ({
  default: () => <div data-testid="mobile-nav">MobileNav</div>,
}));

import AppShell from '@/layouts/AppShell';

describe('AppShell layout', () => {
  it('wraps header and tabs in a sticky container', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const header = screen.getByTestId('header');
    const tabs = screen.getByTestId('tabs');

    // Header is a direct child of the sticky wrapper
    const stickyWrapper = header.parentElement!;
    expect(stickyWrapper.className).toContain('sticky');
    expect(stickyWrapper.className).toContain('top-0');
    expect(stickyWrapper.className).toContain('z-50');

    // Tabs are inside a hidden-on-mobile wrapper within the same sticky container
    const tabsDesktopWrapper = tabs.parentElement!;
    expect(tabsDesktopWrapper.className).toContain('hidden');
    expect(tabsDesktopWrapper.className).toContain('md:block');
    expect(tabsDesktopWrapper.parentElement).toBe(stickyWrapper);
  });

  it('renders footer with GitHub link', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('href', 'https://github.com/njbrake/porchsongs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/Made with/)).toBeInTheDocument();
  });

  it('renders footer with X (Twitter) link', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: 'X (Twitter)' });
    expect(link).toHaveAttribute('href', 'https://x.com/natebrake');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders feature request link in footer', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: /feature request/i });
    expect(link).toHaveAttribute('href');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders report issue link in footer', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const link = screen.getByRole('link', { name: /report issue/i });
    expect(link).toHaveAttribute('href');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('sets maximum-scale=1 on iOS to prevent auto-zoom', () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) {
      const m = document.createElement('meta');
      m.name = 'viewport';
      m.content = 'width=device-width, initial-scale=1.0';
      document.head.appendChild(m);
    }

    // Simulate iOS user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
      configurable: true,
    });

    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toContain('maximum-scale=1');

    // Restore user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
      configurable: true,
    });
  });
});
