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
});
