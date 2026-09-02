import { test, expect, type Page } from '@playwright/test';
import { createSongViaApi, getDefaultProfileId } from '../fixtures/test-helpers';

/**
 * The chord panel on the play route, at the two widths it is built for.
 *
 * Its unit tests cover what it knows about the chart. What they cannot cover is
 * the layout, because it is entirely CSS: from `lg` up the panel is a column
 * beside the chart, and below `lg` it takes the surface and the chart is hidden
 * with `display: none`. jsdom applies no stylesheet, so both look identical
 * there.
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

  test('is dragged wider from its left edge, and stays there', async ({ page, baseURL }) => {
    // The unit tests drive the keyboard path, because jsdom has no pointer and
    // no layout. This is the one that actually drags.
    await openChart(page, baseURL!);
    await page.getByRole('button', { name: 'Chords', exact: true }).click();

    const panel = page.getByRole('complementary');
    await expect(panel).toBeVisible();
    const before = (await panel.boundingBox())!.width;

    const handle = page.getByRole('separator', { name: 'Resize chord panel' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Leftwards widens it: the panel is on the right.
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();

    const after = (await panel.boundingBox())!.width;
    expect(after).toBeGreaterThan(before + 100);

    // And it is still that wide on the next chart, not just until the panel
    // closes.
    await page.reload();
    await page.getByRole('button', { name: 'Chords', exact: true }).click();
    await expect(panel).toBeVisible();
    expect(Math.round((await panel.boundingBox())!.width)).toBe(Math.round(after));
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
    // The way back is the same button, which stays in the bottom bar.
    await expect(page.getByRole('button', { name: 'Chords', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Chords', exact: true }).click();
    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(words).toBeVisible();
  });
});
