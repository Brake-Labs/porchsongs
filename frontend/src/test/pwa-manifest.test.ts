import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

describe("PWA manifest", () => {
  const manifestPath = resolve(__dirname, "../../public/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

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
  const htmlPath = resolve(__dirname, "../../index.html");
  const html = readFileSync(htmlPath, "utf-8");

  it("links to manifest.json", () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('href="/manifest.json"');
  });

  it("has apple-mobile-web-app-capable", () => {
    expect(html).toContain('name="apple-mobile-web-app-capable"');
    expect(html).toContain('content="yes"');
  });

  it("has apple-mobile-web-app-status-bar-style", () => {
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style"');
  });

  it("has apple-mobile-web-app-title", () => {
    expect(html).toContain('name="apple-mobile-web-app-title"');
    expect(html).toContain('content="porchsongs"');
  });

  it("has theme-color meta tag", () => {
    expect(html).toContain('name="theme-color"');
  });
});
