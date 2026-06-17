import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import UpdateBanner from './UpdateBanner';

function bootedFrom(bundle: string): HTMLScriptElement {
  const s = document.createElement('script');
  s.type = 'module';
  s.src = `/assets/${bundle}`;
  s.setAttribute('data-test', '1');
  document.head.appendChild(s);
  return s;
}

function mockBuildId(serverId: string | null, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => ({ web_build_id: serverId }),
  } as Response);
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('script[data-test]').forEach((n) => n.remove());
  vi.restoreAllMocks();
});

describe('UpdateBanner', () => {
  it('shows a reload prompt when the server reports a different bundle', async () => {
    bootedFrom('index-old.js');
    vi.stubGlobal('fetch', mockBuildId('index-new.js'));
    render(<UpdateBanner />);
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /update available/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('stays hidden when the bundle matches', async () => {
    bootedFrom('index-same.js');
    const fetchMock = mockBuildId('index-same.js');
    vi.stubGlobal('fetch', fetchMock);
    render(<UpdateBanner />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('status', { name: /update available/i })).not.toBeInTheDocument();
  });

  it('does nothing on the dev server shell (no hashed entry, no fetch)', async () => {
    const fetchMock = mockBuildId('index-new.js');
    vi.stubGlobal('fetch', fetchMock);
    render(<UpdateBanner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('status', { name: /update available/i })).not.toBeInTheDocument();
  });
});
