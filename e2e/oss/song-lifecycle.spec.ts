import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  navigateToTab,
  mockProviders,
  mockProviderModels,
  presetLlmSettings,
  createSongViaApi,
  createChatMessagesViaApi,
  getDefaultProfileId,
} from '../fixtures/test-helpers';
import {
  interceptLlmEndpoints,
  mockParseStreamResponse,
  mockChatStreamResponse,
} from '../fixtures/mock-sse';
import {
  RAW_LYRICS,
  PARSED_TITLE,
  PARSED_ARTIST,
  PARSED_CONTENT,
  REWRITTEN_CONTENT,
  CHANGES_SUMMARY,
  makeSongCreatePayload,
} from '../fixtures/mock-data';

test.describe('Song Lifecycle', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await presetLlmSettings(page, baseURL!);
    await mockProviders(page);
    await mockProviderModels(page);
  });

  test('parsed song is saved on first chat and appears in library', async ({ page }) => {
    // Mock both parse and chat SSE endpoints
    const parseResponse = mockParseStreamResponse(PARSED_CONTENT, {
      original_content: PARSED_CONTENT,
      title: PARSED_TITLE,
      artist: PARSED_ARTIST,
      reasoning: null,
    });

    const chatResponse = mockChatStreamResponse(
      `<content>\n${REWRITTEN_CONTENT}\n</content>\n\n${CHANGES_SUMMARY}`,
      {
        rewritten_content: REWRITTEN_CONTENT,
        original_content: null,
        assistant_message: CHANGES_SUMMARY,
        changes_summary: CHANGES_SUMMARY,
        version: 2,
        reasoning: null,
        usage: null,
      },
    );

    await interceptLlmEndpoints(page, {
      parseBody: parseResponse,
      chatBody: chatResponse,
    });

    // Navigate and parse
    await page.goto('/');
    await waitForAppReady(page);

    const textarea = page.getByPlaceholder(/Paste or drop lyrics/);
    await textarea.fill(RAW_LYRICS);
    await page.getByRole('button', { name: 'Import Song' }).click();

    // Wait for parse to complete
    await expect(page.getByLabel('Song title').first()).toHaveValue(PARSED_TITLE, { timeout: 10_000 });

    // Send a chat message — this triggers auto-save via onBeforeSend
    const chatInput = page.getByPlaceholder('Your song is ready. How would you like to change it?');
    await expect(chatInput).toBeVisible({ timeout: 5_000 });
    await chatInput.fill('Change "wretch" to "soul"');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for the chat response to complete (assistant message appears)
    await expect(page.getByText(CHANGES_SUMMARY).first()).toBeVisible({ timeout: 10_000 });

    // Now navigate to Library and verify the song appears
    await navigateToTab(page, 'Library');
    await expect(page.getByText(PARSED_TITLE).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(new RegExp(`by ${PARSED_ARTIST}`)).first()).toBeVisible();
  });

  test('chat edit updates rewritten lyrics', async ({ page, baseURL }) => {
    // Seed a song via API so we can load it directly
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    // Mock the chat SSE endpoint
    const chatResponse = mockChatStreamResponse(
      `<content>\n${REWRITTEN_CONTENT}\n</content>\n\n${CHANGES_SUMMARY}`,
      {
        rewritten_content: REWRITTEN_CONTENT,
        original_content: null,
        assistant_message: CHANGES_SUMMARY,
        changes_summary: CHANGES_SUMMARY,
        version: 2,
        reasoning: null,
        usage: null,
      },
    );
    await interceptLlmEndpoints(page, { chatBody: chatResponse });

    // Navigate to Library, open song, click "Edit in Rewrite"
    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    await expect(page.getByText(/by John Newton/).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(/by John Newton/).first().click();

    await expect(page.getByRole('button', { name: /Edit in Rewrite/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Edit in Rewrite/i }).click();
    await expect(page).toHaveURL(/\/app\/rewrite/);

    // Send a chat message
    const chatInput = page.getByPlaceholder('Your song is ready. How would you like to change it?');
    await expect(chatInput).toBeVisible({ timeout: 5_000 });
    await chatInput.fill('Change "wretch" to "soul"');
    await page.getByRole('button', { name: 'Send' }).click();

    // Verify the assistant response appears in chat
    await expect(page.getByText(CHANGES_SUMMARY).first()).toBeVisible({ timeout: 10_000 });

    // Verify the rewritten content updated (check for "soul" instead of "wretch")
    await expect(page.getByText(/saved a soul like/).first()).toBeVisible({ timeout: 5_000 });
  });

  test('chat history persists when reopening a song', async ({ page, baseURL }) => {
    // Seed a song and chat messages directly via API
    const profileId = await getDefaultProfileId(baseURL!);
    const song = await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));
    const songId = song.id as number;
    await createChatMessagesViaApi(baseURL!, songId, [
      { role: 'user', content: 'Change "wretch" to "soul"' },
      { role: 'assistant', content: CHANGES_SUMMARY },
    ]);

    // Load the song from library
    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    await expect(page.getByText(/by John Newton/).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(/by John Newton/).first().click();
    await expect(page.getByRole('button', { name: /Edit in Rewrite/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Edit in Rewrite/i }).click();

    // Verify chat history is loaded — both user message and assistant response
    await expect(page.getByText('Change "wretch" to "soul"').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(CHANGES_SUMMARY).first()).toBeVisible();

    // Navigate away and come back to verify persistence
    await navigateToTab(page, 'Library');
    await expect(page.getByText(PARSED_TITLE).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(/by John Newton/).first().click();
    await expect(page.getByRole('button', { name: /Edit in Rewrite/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Edit in Rewrite/i }).click();

    // Chat history still present after round-trip
    await expect(page.getByText('Change "wretch" to "soul"').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(CHANGES_SUMMARY).first()).toBeVisible();
  });
});
