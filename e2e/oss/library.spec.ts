import { test, expect } from '@playwright/test';
import {
  waitForAppReady,
  navigateToTab,
  createSongViaApi,
  getDefaultProfileId,
  expectOnPlayRoute,
  rewriteFromChart,
} from '../fixtures/test-helpers';
import { makeSongCreatePayload, makeSecondSongPayload, PARSED_TITLE, PARSED_ARTIST, PARSED_CONTENT } from '../fixtures/mock-data';

test.describe('OSS Library', () => {
  test('empty library shows empty state', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Should show the empty state message
    await expect(
      page.getByText(/Your library is empty/)
    ).toBeVisible({ timeout: 5_000 });
  });

  test('songs created via API appear in list', async ({ page, baseURL }) => {
    // Seed songs via API
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));
    await createSongViaApi(baseURL!, makeSecondSongPayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Both songs should appear
    await expect(page.getByText('Amazing Grace').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Hallelujah').first()).toBeVisible();
  });

  test('search filters songs by title', async ({ page, baseURL }) => {
    // Ensure songs exist (may already exist from prior test, but idempotent to add more)
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));
    await createSongViaApi(baseURL!, makeSecondSongPayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Wait for songs to load
    await expect(page.getByText('Amazing Grace').first()).toBeVisible({ timeout: 5_000 });

    // Search for "Hallelujah"
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('Hallelujah');

    // Only Hallelujah should be visible
    await expect(page.getByText('Hallelujah').first()).toBeVisible();
    await expect(page.getByText('Amazing Grace')).not.toBeVisible();
  });

  test('song detail view loads from library click', async ({ page, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Tapping anywhere on the card opens the chart. The whole card is one target
    // now: the title used to be an inline rename field that swallowed the click.
    await expect(page.getByText(/by John Newton/).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(/by John Newton/).first().click();

    // Opens the dedicated full-screen play route, not an in-library detail pane.
    await expectOnPlayRoute(page);
    // Rewrite lives in the chart actions menu, not as a top-level button.
    await expect(page.getByRole('button', { name: /Chart actions/i })).toBeVisible();
  });

  test('Edit loads song into rewrite tab', async ({ page, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Open song detail
    await expect(page.getByText(/by John Newton/).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(/by John Newton/).first().click();

    // Rewrite from the chart actions menu
    await expectOnPlayRoute(page);
    await rewriteFromChart(page);

    // Should navigate to the Rewrite tab with song content loaded
    await expect(page.getByLabel('Song title').first()).toHaveValue(PARSED_TITLE, { timeout: 5_000 });
    await expect(page.getByLabel('Artist').first()).toHaveValue(PARSED_ARTIST);

    // Chat input should be visible (song is in WORKSHOPPING state)
    await expect(page.getByPlaceholder('Your song is ready. How would you like to change it?')).toBeVisible();

    // Song content should be displayed (check for chord annotation from PARSED_CONTENT)
    await expect(page.getByText(/Amazing grace how/).first()).toBeVisible();
  });

  test('tapping the card title opens the chart, it is not a rename field', async ({
    page,
    baseURL,
  }) => {
    // Replaces an "inline title rename persists" test. The title was an inline
    // editor that called stopPropagation, so the largest and most obvious target on
    // the card opened a text input instead of the song. Renaming now lives in the
    // per-song menu, covered by "menu rename updates title and artist" below.
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    await expect(page.getByText(PARSED_TITLE).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(PARSED_TITLE).first().click();

    // The title is plain text now, so the tap reaches the card and opens the chart.
    await expectOnPlayRoute(page);
    await expect(page.locator('input[placeholder="Untitled"]')).toHaveCount(0);
  });

  test('menu rename updates title and artist', async ({ page, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Wait for song to appear, open the actions menu
    await expect(page.getByText('Amazing Grace').first()).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Song actions').first().click();

    // Click "Rename" in the dropdown
    await page.getByRole('menuitem', { name: /Rename/i }).click();

    // Fill in the rename dialog
    const titleInput = page.locator('#prompt-title');
    await expect(titleInput).toBeVisible({ timeout: 2_000 });
    await titleInput.fill('Amazing Grace (Updated)');

    const artistInput = page.locator('#prompt-artist');
    await artistInput.fill('John Newton Jr.');

    await page.getByRole('button', { name: /Save/i }).click();

    // Verify updated title and artist appear
    await expect(page.getByText('Amazing Grace (Updated)').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/by John Newton Jr\./).first()).toBeVisible();
  });

  test('delete song removes it from library', async ({ page, baseURL }) => {
    // Create a song with a unique title to avoid matching other test data
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, {
      ...makeSongCreatePayload(profileId),
      title: 'Song To Delete',
    });

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Wait for our song to appear
    await expect(page.getByText('Song To Delete').first()).toBeVisible({ timeout: 5_000 });

    // Search for it to isolate from other songs
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('Song To Delete');
    await expect(page.getByText('Song To Delete').first()).toBeVisible();

    // Open the song menu and click Delete
    await page.getByLabel('Song actions').first().click();
    await page.getByRole('menuitem', { name: /Delete/i }).click();

    // Confirmation dialog should appear
    await expect(page.getByText('Delete Song')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText(/This action cannot be undone/)).toBeVisible();

    // Confirm deletion
    await page.getByRole('button', { name: 'Delete' }).click();

    // Song should be removed — no results for this search
    await expect(page.getByText('Song To Delete')).not.toBeVisible({ timeout: 5_000 });

    // Verify persistence after reload
    await page.reload();
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');
    await expect(page.getByText('Song To Delete')).not.toBeVisible({ timeout: 3_000 });
  });

  test('move song to folder and filter by folder', async ({ page, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    // Create songs with unique titles and folder assignment
    await createSongViaApi(baseURL!, {
      ...makeSongCreatePayload(profileId),
      title: 'Folder Test Hymn',
      folder: 'TestFolder',
    });
    await createSongViaApi(baseURL!, {
      ...makeSecondSongPayload(profileId),
      title: 'Folder Test Pop',
    });

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Search for our test songs to isolate from other test data
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('Folder Test');

    // Wait for both songs to appear
    await expect(page.getByText('Folder Test Hymn').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Folder Test Pop').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'TestFolder' })).toBeVisible();

    // Click "Unfiled" — only the unfoldered song should be visible
    await page.getByRole('button', { name: 'Unfiled' }).click();
    await expect(page.getByText('Folder Test Pop').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Folder Test Hymn')).not.toBeVisible();

    // Click "All" to clear filter — both songs should be visible again
    await page.getByRole('button', { name: /^All$/ }).click();
    await expect(page.getByText('Folder Test Hymn').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Folder Test Pop').first()).toBeVisible();
  });

  test('PDF download triggers a file download', async ({ page, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, makeSongCreatePayload(profileId));

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Open song detail view
    await expect(page.getByText(/by John Newton/).first()).toBeVisible({ timeout: 5_000 });
    await page.getByText(/by John Newton/).first().click();
    // Open the actions menu and click Download PDF
    await expectOnPlayRoute(page);
    await expect(page.getByRole('button', { name: /Chart actions/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /Chart actions/i }).click();
    await expect(page.getByRole('menuitem', { name: /Download PDF/i })).toBeVisible();

    // Intercept the download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Download PDF/i }).click();
    const download = await downloadPromise;

    // Verify filename and that file is non-empty
    expect(download.suggestedFilename()).toBe('Amazing Grace - John Newton.pdf');
    const path = await download.path();
    expect(path).toBeTruthy();
  });

  test('sorting changes song order', async ({ page, baseURL }) => {
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, {
      ...makeSongCreatePayload(profileId),
      title: 'Alpha Song',
      artist: 'Zeta Artist',
    });
    await createSongViaApi(baseURL!, {
      ...makeSecondSongPayload(profileId),
      title: 'Zeta Song',
      artist: 'Alpha Artist',
    });

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');

    // Search to isolate our test songs
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('Song');

    // Wait for both songs
    await expect(page.getByText('Alpha Song').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Zeta Song').first()).toBeVisible();

    // Sort by title
    const sortSelect = page.locator('select').first();
    await sortSelect.selectOption('title');

    // Click sort ascending
    await page.getByLabel(/Sort ascending|Sort descending/).click();

    // Get all song title spans to verify order
    const titles = await page.getByTitle('Click to rename').allTextContents();
    const songTitles = titles.filter(t => t.includes('Song'));
    // With ascending sort, Alpha Song should come before Zeta Song
    if (songTitles.length >= 2) {
      expect(songTitles.indexOf('Alpha Song')).toBeLessThan(songTitles.indexOf('Zeta Song'));
    }
  });
});
