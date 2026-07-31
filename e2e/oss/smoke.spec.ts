import { test, expect } from '@playwright/test';
import { waitForAppReady } from '../fixtures/test-helpers';

test.describe('OSS Smoke Tests', () => {
  test('health endpoint returns ok', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('app loads with header and tabs', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // Header is visible
    await expect(page.getByRole('link', { name: /porchsongs/i })).toBeVisible();

    // All three tabs visible
    await expect(page.getByRole('tab', { name: 'Import' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Library' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible();

    // No login page
    await expect(page.getByPlaceholder('Password')).not.toBeVisible();
  });

  test('auth config returns required false', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/auth/config`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.required).toBe(false);
  });

  test('auto-created profile exists', async ({ request, baseURL }) => {
    // First hit the app to trigger auto-profile creation
    const res = await request.get(`${baseURL}/api/profiles`);
    expect(res.ok()).toBe(true);
    const profiles = await res.json();
    expect(profiles.length).toBeGreaterThanOrEqual(1);
    expect(profiles[0].is_default).toBe(true);
  });
});
