import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Wait for the app to be fully loaded (tabs visible). */
export async function waitForAppReady(page: Page): Promise<void> {
  // The tab bar renders TabsTrigger elements with role="tab"
  await expect(page.getByRole('tab', { name: 'New Song' })).toBeVisible({ timeout: 15_000 });
}

/** Click a main tab by name (New Song, Library, Settings). */
export async function navigateToTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
}

/**
 * Wait for the full-screen play route to be showing a chart.
 *
 * Tapping a song card in the library opens /app/play/:uuid rather than an
 * in-library detail pane.
 */
export async function expectOnPlayRoute(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/app\/play\//, { timeout: 5_000 });
  await expect(page.getByRole('button', { name: /Back to library/i })).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * From the play route, start an AI rewrite of the open chart.
 *
 * Rewrite used to be a top-level button on the song detail pane. It is now an item
 * in the chart actions menu, because on a performance surface the controls you
 * need while playing are not the ones that navigate away from it. Centralised here
 * so a future change to that menu touches one place instead of five specs.
 */
export async function rewriteFromChart(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Chart actions/i }).click();
  await page.getByRole('menuitem', { name: /Rewrite with AI/i }).click();
  await expect(page).toHaveURL(/\/app\/rewrite/, { timeout: 5_000 });
}

/** Create a song via the API (bypassing the UI for seeding test data). */
export async function createSongViaApi(
  baseUrl: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}/api/songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Failed to create song: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Get the auto-created default profile ID. */
export async function getDefaultProfileId(baseUrl: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/profiles`);
  if (!res.ok) {
    throw new Error(`Failed to fetch profiles: ${res.status}`);
  }
  const profiles = (await res.json()) as Array<{ id: number; is_default: boolean }>;
  const def = profiles.find((p) => p.is_default) ?? profiles[0];
  if (!def) {
    throw new Error('No profiles found');
  }
  return def.id;
}

/** Intercept /api/models to return a fake gateway model catalog. */
export async function mockModels(page: Page): Promise<void> {
  await page.route('**/api/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [
          'personal-ps-anthropic:claude-sonnet-4-6',
          'personal-ps-anthropic:claude-haiku-4-5-20251001',
        ],
      }),
    });
  });
}

/** Seed chat messages for a song via the API. */
export async function createChatMessagesViaApi(
  baseUrl: string,
  songId: number,
  messages: Array<{ role: string; content: string; is_note?: boolean }>
): Promise<void> {
  const res = await fetch(`${baseUrl}/api/songs/${songId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    throw new Error(`Failed to create messages: ${res.status} ${await res.text()}`);
  }
}

/** Set localStorage keys to pre-configure a gateway model so tests skip model selection. */
export async function presetLlmSettings(page: Page, baseUrl: string): Promise<void> {
  await page.goto(baseUrl);
  await page.evaluate(() => {
    localStorage.setItem('porchsongs_model', 'personal-ps-anthropic:claude-sonnet-4-6');
    localStorage.setItem('porchsongs_reasoning_effort', 'high');
  });
}
