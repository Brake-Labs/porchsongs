import { afterEach, describe, expect, it } from 'vitest';
import { currentWebBuildId, isWebUpdateAvailable } from './webBuildId';

function docWith(...scripts: string[]): Document {
  const html = scripts.map((src) => `<script type="module" src="${src}"></script>`).join('');
  return new DOMParser().parseFromString(`<!doctype html><head>${html}</head>`, 'text/html');
}

describe('currentWebBuildId', () => {
  afterEach(() => {
    document.querySelectorAll('script[data-test]').forEach((n) => n.remove());
  });

  it('reads the hashed entry bundle off the module script tag', () => {
    const doc = docWith('/assets/vendor-Bx91yz.js', '/assets/index-DKenwdW0.js');
    expect(currentWebBuildId(doc)).toBe('index-DKenwdW0.js');
  });

  it('returns null on the dev-server shell (unhashed /src/main.tsx entry)', () => {
    expect(currentWebBuildId(docWith('/src/main.tsx'))).toBeNull();
  });

  it('ignores a query string after the bundle name', () => {
    expect(currentWebBuildId(docWith('/assets/index-AbC123.js?v=2'))).toBe('index-AbC123.js');
  });
});

describe('isWebUpdateAvailable', () => {
  it('is true only when both ids are present and differ', () => {
    expect(isWebUpdateAvailable('index-a.js', 'index-b.js')).toBe(true);
    expect(isWebUpdateAvailable('index-a.js', 'index-a.js')).toBe(false);
  });

  it('is false when either side is missing (check disabled)', () => {
    expect(isWebUpdateAvailable(null, 'index-b.js')).toBe(false);
    expect(isWebUpdateAvailable('index-a.js', null)).toBe(false);
    expect(isWebUpdateAvailable('index-a.js', undefined)).toBe(false);
  });
});
