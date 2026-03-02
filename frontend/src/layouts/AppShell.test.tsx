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

import AppShell from '@/layouts/AppShell';

describe('AppShell layout', () => {
  it('wraps header and tabs in a sticky container', () => {
    renderWithRouter(<AppShell />, { route: '/app/rewrite' });

    const header = screen.getByTestId('header');
    const tabs = screen.getByTestId('tabs');

    // Header and tabs should share the same parent wrapper
    const wrapper = header.parentElement!;
    expect(wrapper).toBe(tabs.parentElement);

    // The wrapper must be sticky and positioned at top
    expect(wrapper.className).toContain('sticky');
    expect(wrapper.className).toContain('top-0');
    expect(wrapper.className).toContain('z-50');
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
});
