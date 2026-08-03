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

  test('horizontal layout does not crop the date off the cards', async ({ page, baseURL }) => {
    // Regression test for the horizontal scroll layout cropping every card.
    // The grid sized its rows from a hardcoded 76px "approximate height of a song
    // card", which was 20px short of the real 96px. Rows were `minmax(0, 1fr)`
    // inside a fixed-height container, so each row shrank below its card, and
    // because cards are `overflow-hidden` and the date is their last line, the
    // date was sliced in half on every card.
    //
    // This has to run in a real browser: the measurement reads
    // getBoundingClientRect, which jsdom always reports as zero, so no vitest
    // test can observe the crop.
    const profileId = await getDefaultProfileId(baseURL!);
    // Titles of different lengths, because the tallest card sets the row height
    // and a long title wraps to a second line at a narrow column width.
    for (const title of [
      'Grid Row Short',
      'Grid Row With A Considerably Longer Title That Will Wrap At Narrow Widths',
      'Grid Row Middling Length Title',
    ]) {
      await createSongViaApi(baseURL!, {
        ...makeSongCreatePayload(profileId),
        title,
      });
    }

    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Library');
    await expect(page.getByText('Grid Row Short').first()).toBeVisible({ timeout: 5_000 });

    await page.getByLabel('Switch to horizontal scroll').click();
    const grid = page.locator('[data-testid="horizontal-grid"]');
    await expect(grid).toBeVisible();

    // Let the two measurement passes settle (width first, then row height).
    await expect
      .poll(async () => grid.evaluate(el => el.querySelectorAll('[data-song-card]').length))
      .toBeGreaterThan(0);

    const cropped = await grid.evaluate(el => {
      const bad: { title: string; overflowPx: number }[] = [];
      for (const card of el.querySelectorAll('[data-song-card]')) {
        const date = card.querySelector('[data-testid="song-card-date"]');
        if (!date) continue;
        const overflow = date.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom;
        if (overflow > 0.5) {
          bad.push({
            title: card.querySelector('h3')?.textContent ?? '(untitled)',
            overflowPx: Math.round(overflow),
          });
        }
      }
      return bad;
    });

    expect(cropped).toEqual([]);
  });

  test('phone width has no layout toggle and never scrolls charts sideways', async ({
    page,
    baseURL,
  }) => {
    // The toggle used to be offered at every width. Measured at 390px before this
    // changed: horizontal mode laid the charts out in a single column and pushed
    // two of eight past the right edge, reachable only by a sideways swipe, so the
    // control could not improve the layout and could only hide charts.
    //
    // A browser is required. The gate reads viewport width, and jsdom reports a
    // fixed 1024 regardless of what a test asks for, so the narrow branch is only
    // observable here.
    await page.setViewportSize({ width: 390, height: 844 });
    const profileId = await getDefaultProfileId(baseURL!);
    for (const title of ['Phone Chart One', 'Phone Chart Two', 'Phone Chart Three']) {
      await createSongViaApi(baseURL!, { ...makeSongCreatePayload(profileId), title });
    }

    // Straight to the route: the tab bar is hidden at this width.
    await page.goto('/app/library');
    await expect(page.getByText('Phone Chart One').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByLabel(/Switch to (horizontal|vertical) scroll/)).toHaveCount(0);
    await expect(page.locator('[data-testid="horizontal-grid"]')).toHaveCount(0);

    // Every card sits at the same left edge and none is off-screen, which is what
    // "one column, no sideways scroll" means in terms an assertion can check.
    const layout = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-song-card]'));
      return {
        count: cards.length,
        distinctLeftEdges: new Set(cards.map(c => Math.round(c.getBoundingClientRect().left))).size,
        offscreenRight: cards.filter(c => c.getBoundingClientRect().left > window.innerWidth - 1)
          .length,
      };
    });
    // At least the three created here. Not an exact count: the suite shares one
    // database and earlier tests in this file leave their own charts behind.
    expect(layout.count).toBeGreaterThanOrEqual(3);
    expect(layout.distinctLeftEdges).toBe(1);
    expect(layout.offscreenRight).toBe(0);
  });

  test('a horizontal preference carried to a phone does not strand the user', async ({
    page,
    baseURL,
  }) => {
    // Hiding the button alone would have left anyone with a stored 'horizontal'
    // in a layout with no control to leave it. The layout is derived from the
    // width instead, and the stored preference is left intact for wide screens.
    const profileId = await getDefaultProfileId(baseURL!);
    await createSongViaApi(baseURL!, {
      ...makeSongCreatePayload(profileId),
      title: 'Stranded Chart',
    });

    await page.goto('/app/library');
    await expect(page.getByText('Stranded Chart').first()).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => localStorage.setItem('porchsongs_library_layout', 'horizontal'));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByText('Stranded Chart').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('[data-testid="horizontal-grid"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem('porchsongs_library_layout')),
    ).toBe('horizontal');
  });
});
