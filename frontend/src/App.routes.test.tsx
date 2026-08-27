import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import App from '@/App';

/**
 * The route table itself.
 *
 * Specifically: that `/app/library/:id` reaches the play route. That path used
 * to mount a second copy of the performance surface inside `LibraryTab`, and
 * because it was a second copy, the chord panel and stored-tab rendering only
 * ever landed on one of the two. It is still in browser history and in
 * bookmarks, and `RewriteTab` sent people to it after a save, so it redirects
 * rather than 404s.
 *
 * `AppShell` and `AuthContext` are stubbed because neither is what is under
 * test here and both reach for the network on mount. The route elements are
 * real, so a rename or a reshuffle of the table fails this.
 */

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ authState: 'authenticated', isPremium: false }),
}));

vi.mock('@/components/UpdateBanner', () => ({ default: () => null }));

// The shell renders chrome and loads a profile. Its Outlet is the only part the
// route table needs.
vi.mock('@/layouts/AppShell', () => ({
  default: () => <Outlet context={{ llmSettings: { model: '' } }} />,
}));

vi.mock('@/components/LibraryTab', () => ({ default: () => <div>LIBRARY LIST</div> }));
vi.mock('@/components/RewriteTab', () => ({ default: () => <div>REWRITE</div> }));

function PlayProbe() {
  const location = useLocation();
  return (
    <div>
      <span>PLAY ROUTE</span>
      <span data-testid="play-path">{location.pathname}</span>
      <span data-testid="play-from">
        {((location.state ?? {}) as { from?: string }).from ?? 'none'}
      </span>
    </div>
  );
}

vi.mock('@/pages/PlayPage', () => ({ default: () => <PlayProbe /> }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('the /app/library/:id redirect', () => {
  it('sends a deep link to a chart to the play route', async () => {
    renderAt('/app/library/abc-123');

    expect(await screen.findByText('PLAY ROUTE')).toBeInTheDocument();
    expect(screen.getByTestId('play-path')).toHaveTextContent('/app/play/abc-123');
  });

  it('leaves the play route a way back to the library', async () => {
    // The play route is full screen and renders its own back button from this.
    // Without it, arriving by deep link has nowhere to go.
    renderAt('/app/library/abc-123');

    await screen.findByText('PLAY ROUTE');
    expect(screen.getByTestId('play-from')).toHaveTextContent('/app/library');
  });

  it('still shows the list at /app/library', async () => {
    renderAt('/app/library');
    expect(await screen.findByText('LIBRARY LIST')).toBeInTheDocument();
  });

  it('redirects the legacy /library/:id path through to the play route', async () => {
    // Two hops: /library/:id -> /app/library/:id -> /app/play/:id.
    renderAt('/library/abc-123');

    await waitFor(() =>
      expect(screen.getByTestId('play-path')).toHaveTextContent('/app/play/abc-123'),
    );
  });
});
