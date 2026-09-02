import { afterEach, describe, expect, it, vi } from 'vitest';
import themeInitSrc from '../../public/theme-init.js?raw';
import indexHtml from '../../index.html?raw';
import { readFileSync } from 'node:fs';

// Off disk, not imported: vitest stubs every CSS import (?raw and ?inline
// included) to an empty string. vitest's cwd is the frontend directory.
const indexCss = readFileSync('src/index.css', 'utf8');

/**
 * public/theme-init.js runs before first paint and cannot import anything (it
 * predates the module graph), so these tests execute its raw source against
 * stubbed globals and assert on the attribute it sets.
 */
describe('theme-init.js', () => {
  function runThemeInit({
    stored = null as string | null,
    systemDark = false,
    storageThrows = false,
  } = {}) {
    document.documentElement.removeAttribute('data-theme');
    vi.stubGlobal('localStorage', {
      getItem: storageThrows
        ? () => {
            throw new Error('storage disabled');
          }
        : (key: string) => (key === 'porchsongs_theme' ? stored : null),
    });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: systemDark && query.includes('dark'),
      media: query,
    }));
    new Function(themeInitSrc)();
    return document.documentElement.getAttribute('data-theme');
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies a stored explicit theme over the system preference', () => {
    expect(runThemeInit({ stored: 'dark', systemDark: false })).toBe('dark');
    expect(runThemeInit({ stored: 'light', systemDark: true })).toBe('light');
  });

  it('resolves system preference when nothing (or "system") is stored', () => {
    expect(runThemeInit({ systemDark: true })).toBe('dark');
    expect(runThemeInit({ systemDark: false })).toBe('light');
    expect(runThemeInit({ stored: 'system', systemDark: true })).toBe('dark');
  });

  it('ignores garbage in storage', () => {
    expect(runThemeInit({ stored: 'blorange', systemDark: true })).toBe('dark');
  });

  it('falls back to the system preference when storage throws', () => {
    expect(runThemeInit({ storageThrows: true, systemDark: true })).toBe('dark');
  });
});

describe('theme-init.js wiring in index.html', () => {
  const head = new DOMParser().parseFromString(indexHtml, 'text/html').head;

  it('is loaded from <head> as a blocking classic script', () => {
    // It must run before first paint: a module, deferred, or async script runs
    // after the parser and re-introduces the cream flash for dark-theme users.
    const script = head.querySelector('script[src="/theme-init.js"]');
    expect(script).not.toBeNull();
    expect(script!.getAttribute('type')).toBeNull();
    expect(script!.hasAttribute('defer')).toBe(false);
    expect(script!.hasAttribute('async')).toBe(false);
  });
});

describe('font manifest', () => {
  const head = new DOMParser().parseFromString(indexHtml, 'text/html').head;
  const href = head.querySelector('link[data-webfonts]')!.getAttribute('href')!;
  const loadedFamilies = [...href.matchAll(/family=([^:&]+)/g)].map((m) =>
    decodeURIComponent(m[1] ?? '').replace(/\+/g, ' '),
  );
  const tokenFamilies = [...indexCss.matchAll(/--font-[a-z]+:\s*'([^']+)'/g)].map((m) => m[1] ?? '');

  it('loads every family the CSS font tokens name first', () => {
    // A token whose primary family is not in the Google Fonts URL silently
    // renders its fallback stack forever.
    for (const family of tokenFamilies) {
      expect(loadedFamilies).toContain(family);
    }
  });

  it('names every loaded family in a CSS font token', () => {
    // The reverse drift: a family nobody references is pure download weight.
    // Geist was shipped to every visitor for one stat line before this check.
    for (const family of loadedFamilies) {
      expect(tokenFamilies).toContain(family);
    }
  });
});

describe('color-scheme', () => {
  it('flips browser UI (scrollbars, form controls) with the theme', () => {
    expect(indexCss).toMatch(/html\s*{[^}]*color-scheme: light/);
    expect(indexCss).toMatch(/html\[data-theme="dark"\]\s*{[^}]*color-scheme: dark/);
  });
});
