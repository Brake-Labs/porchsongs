import { enableWebFonts } from '@/lib/webfonts';

function addWebfontLink(media = 'print'): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.media = media;
  link.setAttribute('data-webfonts', '');
  link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif';
  document.head.appendChild(link);
  return link;
}

/** jsdom never fetches subresources, so the load event has to be faked. */
function finishLoading(link: HTMLLinkElement): void {
  link.dispatchEvent(new Event('load'));
}

describe('enableWebFonts', () => {
  afterEach(() => {
    document.head.querySelectorAll('link[data-webfonts]').forEach((l) => l.remove());
  });

  it('leaves the stylesheet non-render-blocking until it has loaded', () => {
    const link = addWebfontLink();

    enableWebFonts();

    // Stay non-render-blocking until the sheet has actually arrived. Whether an
    // early flip would re-arm render-blocking is unverified (it did not
    // reproduce in Chromium), but waiting is the safe order and costs nothing.
    expect(link.media).toBe('print');
  });

  it('applies the fonts once the stylesheet has loaded', () => {
    const link = addWebfontLink();

    enableWebFonts();
    finishLoading(link);

    expect(link.media).toBe('all');
  });

  it('applies immediately when the stylesheet is already parsed', () => {
    const link = addWebfontLink();
    Object.defineProperty(link, 'sheet', { value: {}, configurable: true });

    enableWebFonts();

    expect(link.media).toBe('all');
  });

  it('never reverts a stylesheet that is already applied', () => {
    const link = addWebfontLink('all');

    enableWebFonts();
    finishLoading(link);

    expect(link.media).toBe('all');
  });

  it('does nothing when the page has no webfont link', () => {
    expect(() => enableWebFonts()).not.toThrow();
  });
});
