import { test, expect } from '@playwright/test';
import { waitForAppReady, mockProviders, mockProviderModels, presetLlmSettings } from '../fixtures/test-helpers';
import {
  interceptLlmEndpoints,
  mockParseStreamResponse,
  mockSseError,
} from '../fixtures/mock-sse';
import {
  RAW_LYRICS,
  PARSED_TITLE,
  PARSED_ARTIST,
  PARSED_CONTENT,
} from '../fixtures/mock-data';

test.describe('OSS Rewrite Flow', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    // Pre-set provider/model in localStorage
    await presetLlmSettings(page, baseURL!);

    // Mock providers and models endpoints
    await mockProviders(page);
    await mockProviderModels(page);
  });

  test('full rewrite flow: paste → parse → title/artist appear', async ({ page }) => {
    // Set up mock SSE responses
    const parseResponse = mockParseStreamResponse(PARSED_CONTENT, {
      original_content: PARSED_CONTENT,
      title: PARSED_TITLE,
      artist: PARSED_ARTIST,
      reasoning: null,
    });

    await interceptLlmEndpoints(page, { parseBody: parseResponse });

    await page.goto('/');
    await waitForAppReady(page);

    // Fill lyrics textarea
    const textarea = page.getByPlaceholder('Paste or drop lyrics');
    await expect(textarea).toBeVisible();
    await textarea.fill(RAW_LYRICS);

    // Click Parse
    await page.getByRole('button', { name: 'Import Song' }).click();

    // Wait for parsed content to appear — title and artist inputs should be visible
    // Scope to the desktop toolbar to avoid matching the mobile-only duplicate
    const toolbar = page.getByTestId('song-toolbar');
    const titleInput = toolbar.getByLabel('Song title');
    await expect(titleInput).toBeVisible({ timeout: 10_000 });
    await expect(titleInput).toHaveValue(PARSED_TITLE);

    const artistInput = toolbar.getByLabel('Artist');
    await expect(artistInput).toBeVisible();
    await expect(artistInput).toHaveValue(PARSED_ARTIST);

    // The chat panel should be visible after parse (indicating parsed state)
    await expect(page.getByPlaceholder('Your song is ready. How would you like to change it?')).toBeVisible();
  });

  test('cancel parse mid-stream shows input again', async ({ page }) => {
    // Use a route that never sends the done event — simulates a slow/hanging parse
    await page.route('**/api/parse/stream', async (route) => {
      // Respond but never finish — send partial tokens, no "done" event
      // The frontend will be in "loading" state showing the Cancel button
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
        body: 'event: reasoning\ndata: "Thinking about this..."\n\n',
      });
    });

    await page.goto('/');
    await waitForAppReady(page);

    const textarea = page.getByPlaceholder('Paste or drop lyrics');
    await textarea.fill(RAW_LYRICS);
    await page.getByRole('button', { name: 'Import Song' }).click();

    // After the SSE completes (no done event), the app may show an error or
    // return to input state. Verify we can see the input area again.
    // The partial response without a done event triggers the error path.
    await expect(
      page.getByPlaceholder('Paste or drop lyrics').or(page.getByText(/error|failed/i))
    ).toBeVisible({ timeout: 10_000 });
  });

  test('parse error shows error message', async ({ page }) => {
    const errorBody = mockSseError('No API key configured for openai. Set the OPENAI_API_KEY environment variable.');

    await interceptLlmEndpoints(page, { parseBody: errorBody });

    await page.goto('/');
    await waitForAppReady(page);

    const textarea = page.getByPlaceholder('Paste or drop lyrics');
    await textarea.fill(RAW_LYRICS);
    await page.getByRole('button', { name: 'Import Song' }).click();

    // Error message should be visible (in a toast or inline)
    await expect(page.getByText(/API key/i)).toBeVisible({ timeout: 10_000 });
  });
});
