import { screen } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import Tabs, { buildTabItems, activeKeyFromPath } from '@/components/Tabs';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isPremium: false, currentAuthUser: null }),
}));

describe('Tabs', () => {
  it('renders all three tab labels', () => {
    renderWithRouter(<Tabs />, { route: '/app/rewrite' });
    expect(screen.getByText('Rewrite')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks the active tab based on URL', () => {
    renderWithRouter(<Tabs />, { route: '/app/library' });
    const libraryTab = screen.getByText('Library');
    expect(libraryTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Rewrite')).toHaveAttribute('data-state', 'inactive');
  });

  it('defaults to rewrite tab for unknown paths', () => {
    renderWithRouter(<Tabs />, { route: '/app/unknown' });
    expect(screen.getByText('Rewrite')).toHaveAttribute('data-state', 'active');
  });
});

describe('activeKeyFromPath', () => {
  it('returns admin for /app/admin path', () => {
    expect(activeKeyFromPath('/app/admin')).toBe('admin');
  });

  it('returns settings for /app/settings paths', () => {
    expect(activeKeyFromPath('/app/settings/models')).toBe('settings');
  });

  it('returns rewrite as default', () => {
    expect(activeKeyFromPath('/app/rewrite')).toBe('rewrite');
  });
});

describe('buildTabItems', () => {
  it('returns three base tabs for non-admin users', () => {
    const tabs = buildTabItems(false, false);
    expect(tabs.map(t => t.key)).toEqual(['rewrite', 'library', 'settings']);
  });

  it('does not include admin tab in OSS mode even if isAdmin is true', () => {
    // In OSS, getExtraTopLevelTabs returns [] regardless
    const tabs = buildTabItems(false, true);
    expect(tabs.find(t => t.key === 'admin')).toBeUndefined();
  });
});
