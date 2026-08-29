import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import Tabs, { buildTabItems, activeKeyFromPath } from '@/components/Tabs';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ isPremium: false, currentAuthUser: null }),
}));

describe('Tabs', () => {
  it('renders every tab label', () => {
    renderWithRouter(<Tabs />, { route: '/app/rewrite' });
    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Chords')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks the active tab based on URL', () => {
    renderWithRouter(<Tabs />, { route: '/app/library' });
    const libraryTab = screen.getByText('Library');
    expect(libraryTab).toHaveAttribute('data-state', 'active');
    expect(screen.getByText('Import')).toHaveAttribute('data-state', 'inactive');
  });

  it('marks Chords active anywhere under the chord dictionary', () => {
    // Chord pages carry the instrument and chord in the path
    // (/app/chords/guitar/g-major), so the tab has to match on prefix.
    renderWithRouter(<Tabs />, { route: '/app/chords/guitar/g-major' });
    expect(screen.getByText('Chords')).toHaveAttribute('data-state', 'active');
  });

  it('defaults to the Library tab for unknown paths', () => {
    // Library is the home surface. /app/play/:uuid renders chromeless and shows no
    // tab bar at all, so an unmatched path must not light up the import screen.
    renderWithRouter(<Tabs />, { route: '/app/unknown' });
    expect(screen.getByText('Library')).toHaveAttribute('data-state', 'active');
  });

  it('Import tab starts a fresh song via onNewSong instead of plain navigation', () => {
    const onNewSong = vi.fn();
    renderWithRouter(<Tabs onNewSong={onNewSong} />, { route: '/app/library' });

    fireEvent.click(screen.getByText('Import'));
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
    // Admin is a premium tab, so OSS no longer knows the path by name. It lights
    // up because the tab says which prefixes are its own.
    const adminTab = { key: 'admin', path: '/app/admin', label: 'Admin' };
    expect(activeKeyFromPath('/app/admin', [adminTab])).toBe('admin');
    expect(activeKeyFromPath('/app/admin/users/7', [adminTab])).toBe('admin');
    // And without it, the path is just an unknown one.
    expect(activeKeyFromPath('/app/admin')).toBe('library');
  });

  it('returns settings for /app/settings paths', () => {
    expect(activeKeyFromPath('/app/settings/models')).toBe('settings');
  });

  it('returns rewrite for /app/rewrite', () => {
    expect(activeKeyFromPath('/app/rewrite')).toBe('rewrite');
  });

  it('returns library for the play route and any unmatched path', () => {
    expect(activeKeyFromPath('/app/play/abc-123')).toBe('library');
    expect(activeKeyFromPath('/app/unknown')).toBe('library');
  });
});

describe('buildTabItems', () => {
  it('returns the base tabs for non-admin users', () => {
    const tabs = buildTabItems(false, false);
    // Library first: the common case on opening the app is finding a song to
    // play, not adding a new one.
    expect(tabs.map(t => t.key)).toEqual(['library', 'rewrite', 'chords', 'settings']);
  });

  it('does not include admin tab in OSS mode even if isAdmin is true', () => {
    // In OSS, getExtraTopLevelTabs returns [] regardless
    const tabs = buildTabItems(false, true);
    expect(tabs.find(t => t.key === 'admin')).toBeUndefined();
  });
});

/**
 * The nav seam, generalised so a premium surface does not need an OSS change to
 * appear, highlight, or carry a count.
 */
describe('extension tabs', () => {
  const friends = {
    key: 'friends',
    path: '/app/friends',
    label: 'Friends',
    match: ['/app/friends'],
  };

  it('places extension tabs before Settings', () => {
    // Settings configures what the other tabs do, so it reads last. Appending
    // after it stranded every premium surface past the end of the nav.
    const keys = buildTabItems(true, false).map((t) => t.key);
    const extraKeys = keys.filter((k) => !['library', 'rewrite', 'chords', 'settings'].includes(k));
    for (const key of extraKeys) {
      expect(keys.indexOf(key)).toBeLessThan(keys.indexOf('settings'));
    }
    expect(keys[keys.length - 1]).toBe('settings');
  });

  it('lights an extension tab from its own match prefixes', () => {
    expect(activeKeyFromPath('/app/friends', [friends])).toBe('friends');
    expect(activeKeyFromPath('/app/friends/requests', [friends])).toBe('friends');
  });

  it('falls back to the tab path when no match list is given', () => {
    const bare = { key: 'friends', path: '/app/friends', label: 'Friends' };
    expect(activeKeyFromPath('/app/friends', [bare])).toBe('friends');
  });

  it('lets an extension tab win over a built-in prefix', () => {
    // Deliberate: an extension owning /app/library/shared should keep its own tab
    // lit rather than handing the highlight to the library underneath it.
    const nested = { key: 'shared', path: '/app/library/shared', label: 'Shared' };
    expect(activeKeyFromPath('/app/library/shared', [nested])).toBe('shared');
    expect(activeKeyFromPath('/app/library', [nested])).toBe('library');
  });
});
