import { describe, expect, it } from "vitest";
// Requires vite-env.d.ts for the ?raw import type declaration
import manifest from "../../public/manifest.json";
import indexHtml from "../../index.html?raw";

describe("PWA manifest", () => {
  it("has display standalone", () => {
    expect(manifest.display).toBe("standalone");
  });

  it("has start_url and scope", () => {
    expect(manifest.start_url).toBe("/app");
    expect(manifest.scope).toBe("/");
  });

  it("has required name fields", () => {
    expect(manifest.name).toBe("porchsongs");
    expect(manifest.short_name).toBe("porchsongs");
  });

  // Colors from DESIGN.md / index.css --color-background tokens
  it("has theme and background colors matching design system", () => {
    expect(manifest.background_color).toBe("#faf9f6");
    expect(manifest.theme_color).toBe("#faf9f6");
  });

  it("has 192x192 and 512x512 icons for Android installability", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("has purpose field on all icons", () => {
    for (const icon of manifest.icons) {
      expect(icon.purpose).toBeTruthy();
    }
  });

  it("has at least one icon", () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(1);
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.type).toBeTruthy();
    }
  });
});

describe("index.html PWA meta tags", () => {
  it("links to manifest.json", () => {
    expect(indexHtml).toContain('rel="manifest"');
    expect(indexHtml).toContain('href="/manifest.json"');
  });

  it("has apple-mobile-web-app-capable", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('content="yes"');
  });

  it("has apple-mobile-web-app-status-bar-style black-translucent", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-status-bar-style"');
    expect(indexHtml).toContain('content="black-translucent"');
  });

  it("has apple-mobile-web-app-title", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-title"');
    expect(indexHtml).toContain('content="porchsongs"');
  });

  // Colors from DESIGN.md: light=#faf9f6, dark=#1c1917
  it("has theme-color for light and dark modes", () => {
    expect(indexHtml).toContain('content="#faf9f6" media="(prefers-color-scheme: light)"');
    expect(indexHtml).toContain('content="#1c1917" media="(prefers-color-scheme: dark)"');
  });
});

/**
 * A cross-origin stylesheet in <head> blocks first paint until its request
 * settles. Every local asset is precached by the service worker and answered in
 * single-digit milliseconds, so on an iOS PWA cold launch with a cold or absent
 * radio the webfont request was the only thing standing between the user and a
 * rendered page: the app showed nothing at all until it timed out.
 */
describe("index.html render-blocking resources", () => {
  const head = new DOMParser().parseFromString(indexHtml, "text/html").head;
  const stylesheets = [...head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];

  it("parks the webfont stylesheet at media=print so it cannot block first paint", () => {
    const webfonts = head.querySelector<HTMLLinkElement>("link[data-webfonts]");
    // src/lib/webfonts.ts finds the link by this attribute and promotes it to
    // media="all" on load. Renaming one without the other silently ships either
    // a blank launch screen or no webfonts.
    expect(webfonts).not.toBeNull();
    expect(webfonts!.getAttribute("media")).toBe("print");
  });

  it("has no render-blocking cross-origin stylesheet", () => {
    const blocking = stylesheets.filter(
      (link) =>
        /^(https?:)?\/\//.test(link.getAttribute("href") ?? "") &&
        link.getAttribute("media") !== "print",
    );
    expect(blocking.map((link) => link.getAttribute("href"))).toEqual([]);
  });
});
