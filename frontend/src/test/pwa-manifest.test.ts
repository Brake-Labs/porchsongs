import { describe, expect, it } from "vitest";
// Use Vite's raw import to read files without Node.js builtins
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

  it("has theme and background colors matching design system", () => {
    expect(manifest.background_color).toBe("#faf9f6");
    expect(manifest.theme_color).toBe("#faf9f6");
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

  it("has theme-color for light and dark modes", () => {
    expect(indexHtml).toContain('content="#faf9f6" media="(prefers-color-scheme: light)"');
    expect(indexHtml).toContain('content="#1c1917" media="(prefers-color-scheme: dark)"');
  });
});
