import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import Tabs, { buildTabItems, activeKeyFromPath } from '@/components/Tabs';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isPremium: false, currentAuthUser: null }),
}));

describe('Tabs', () => {
  it('renders all three tab labels (import tab is "New Song")', () => {
    renderWithRouter(<Tabs />, { route: '/app/rewrite' });
    expect(screen.getByText('New Song')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks the active tab based on URL', () => {
    renderWithRouter(<Tabs />, { route: '/app/library' });
    const libraryTab = screen.getByText('Library');
    expect(libraryTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('New Song')).toHaveAttribute('data-state', 'inactive');
  });

  it('defaults to the New Song tab for unknown paths', () => {
    renderWithRouter(<Tabs />, { route: '/app/unknown' });
    expect(screen.getByText('New Song')).toHaveAttribute('data-state', 'active');
  });

  it('New Song tab starts a fresh song via onNewSong instead of plain navigation', () => {
    const onNewSong = vi.fn();
    renderWithRouter(<Tabs onNewSong={onNewSong} />, { route: '/app/library' });

    fireEvent.click(screen.getByText('New Song'));
    expect(onNewSong).toHaveBeenCalledTimes(1);
  });

  it('other tabs navigate normally (do not trigger onNewSong)', () => {
    const onNewSong = vi.fn();
    renderWithRouter(<Tabs onNewSong={onNewSong} />, { route: '/app/rewrite' });

    fireEvent.click(screen.getByText('Library'));
    expect(onNewSong).not.toHaveBeenCalled();
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
