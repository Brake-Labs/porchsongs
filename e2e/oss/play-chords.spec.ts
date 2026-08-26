import { test, expect, type Page } from '@playwright/test';
import { createSongViaApi, getDefaultProfileId } from '../fixtures/test-helpers';

/**
 * The chord panel on the play route, at the two widths it is built for.
 *
 * Its unit tests cover what it knows about the chart. What they cannot cover is
 * the layout, because it is entirely CSS: from `lg` up the panel is a column
 * beside the chart, and below `lg` it takes the surface and the chart is not
 * rendered at all. jsdom applies no stylesheet, so both look identical there.
 */

const CHART = [
  '[Verse 1]',
  '[G]Amazing grace how [C]sweet the sound',
  'That [G]saved a wretch like [D7]me',
].join('\n');

async function openChart(page: Page, baseURL: string): Promise<void> {
  const profileId = await getDefaultProfileId(baseURL);
  const song = (await createSongViaApi(baseURL, {
    profile_id: profileId,
    title: 'Chord Panel Test',
    artist: 'Trad',
    original_content: CHART,
    rewritten_content: CHART,
    changes_summary: null,
  })) as { uuid: string };

  // Straight to the play route rather than in through the library: this is a
  // chromeless surface with no tab bar, and at phone width there is not one to
  // wait for anyway.
  await page.goto(`/app/play/${song.uuid}`);
  await expect(page.getByRole('button', { name: 'Chords', exact: true })).toBeVisible({ timeout: 10_000 });
}

test.describe('Chord panel beside a chart', () => {
  test('opens as a column, leaving the chart on screen', async ({ page, baseURL }) => {
    await openChart(page, baseURL!);
    const words = page.getByText('Amazing grace how').first();
    await expect(words).toBeVisible();

    await page.getByRole('button', { name: 'Chords', exact: true }).click();

    // The point of docking rather than floating: both at once.
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(words).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In this song' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'D7', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Close chords' }).click();
    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(words).toBeVisible();
  });
});

test.describe('Chord panel on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('takes the surface, so the shapes are not squeezed into a sliver', async ({
    page,
    baseURL,
  }) => {
    await openChart(page, baseURL!);
    const words = page.getByText('Amazing grace how').first();
    await expect(words).toBeVisible();

    await page.getByRole('button', { name: 'Chords', exact: true }).click();

    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(words).toBeHidden();
    // The way back is the same button, which stays in the header.
    await expect(page.getByRole('button', { name: 'Chords', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Chords', exact: true }).click();
    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(words).toBeVisible();
  });
});
