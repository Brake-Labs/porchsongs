/**
 * Applies the Google Fonts stylesheet without letting it block first paint.
 *
 * index.html ships the link as `media="print"`, which still downloads the
 * stylesheet but excludes it from render-blocking. This promotes it to
 * `media="all"` once the download has finished, so the fonts apply as soon as
 * they are actually available and never a moment before.
 *
 * Waiting for `load` matters. Flipping the media query while the sheet is still
 * in flight re-arms it as render-blocking, which would put the blank screen
 * straight back.
 *
 * If the request never completes (offline, captive portal, a cold cellular
 * radio) the media query simply stays `print` and the app renders in the
 * fallback stack. That is the correct outcome for an app whose whole point is
 * that a chart opens with no signal.
 */
export function enableWebFonts(doc: Document = document): void {
  const link = doc.querySelector<HTMLLinkElement>('link[data-webfonts]');
  if (!link || link.media === 'all') return;

  const apply = () => {
    link.media = 'all';
  };

  // `sheet` is populated once the stylesheet has parsed, regardless of media.
  if (link.sheet) apply();
  else link.addEventListener('load', apply, { once: true });
}
