import { test, expect } from '@playwright/test';
import { waitForAppReady, navigateToTab } from '../fixtures/test-helpers';

test.describe('OSS Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('tab switching updates URL', async ({ page }) => {
    // Library is the default landing surface.
    await expect(page).toHaveURL(/\/app\/library$/);

    await navigateToTab(page, 'Settings');
    await expect(page).toHaveURL(/\/app\/settings\/models$/);

    await navigateToTab(page, 'Import');
    await expect(page).toHaveURL(/\/app\/rewrite$/);

    await navigateToTab(page, 'Library');
    await expect(page).toHaveURL(/\/app\/library$/);
  });

  test('direct URL navigation works', async ({ page }) => {
    await page.goto('/app/library');
    await waitForAppReady(page);
    await expect(page.getByRole('tab', { name: 'Library' })).toHaveAttribute(
      'data-state',
      'active'
    );

    await page.goto('/app/settings/prompts');
    await waitForAppReady(page);
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'data-state',
      'active'
    );
  });

  test('settings sub-tabs (models, prompts)', async ({ page }) => {
    await navigateToTab(page, 'Settings');
    await expect(page).toHaveURL(/\/app\/settings\/models$/);

    // Click "System Prompts" sub-tab
    await page.getByRole('button', { name: 'System Prompts' }).click();
    await expect(page).toHaveURL(/\/app\/settings\/prompts$/);

    // Click "Model" sub-tab
    await page.getByRole('button', { name: 'Model' }).click();
    await expect(page).toHaveURL(/\/app\/settings\/models$/);
  });

  test('browser back/forward preserves state', async ({ page }) => {
    await navigateToTab(page, 'Library');
    await expect(page).toHaveURL(/\/app\/library$/);

    await navigateToTab(page, 'Settings');
    await expect(page).toHaveURL(/\/app\/settings\/models$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/library$/);
    await expect(page.getByRole('tab', { name: 'Library' })).toHaveAttribute(
      'data-state',
      'active'
    );

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/settings\/models$/);
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'data-state',
      'active'
    );
  });

  test('paths under /app/admin resolve to the admin route, not the 404 page', async ({ page }) => {
    // The admin route is a splat (`admin/*`) so a premium build can own everything
    // below /app/admin and route its own sections and per-user detail pages. With an
    // exact `admin` path, anything deeper fell through to the catch-all 404.
    //
    // In OSS the admin element redirects to /app, which then lands on the library.
    // That redirect is the observable proof the splat matched: the 404 page renders
    // "Page not found" and does not navigate anywhere.
    for (const path of ['/app/admin', '/app/admin/users', '/app/admin/users/42']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/app\/library$/, { timeout: 10_000 });
      await expect(page.getByText('Page not found')).toHaveCount(0);
    }
  });

  test('an unknown path outside /app/admin still shows the 404 page', async ({ page }) => {
    // Guards the other direction: the splat must not have swallowed the catch-all.
    await page.goto('/app/definitely-not-a-route');
    await expect(page.getByText('Page not found')).toBeVisible({ timeout: 10_000 });
  });
});
