import { test, expect } from '@playwright/test';
import { waitForAppReady, navigateToTab, mockModels } from '../fixtures/test-helpers';

test.describe('OSS Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await navigateToTab(page, 'Settings');
  });

  test('model tab shown by default in OSS mode', async ({ page }) => {
    await expect(page).toHaveURL(/\/settings\/models$/);
    // Model sub-tab should be active
    await expect(page.getByRole('button', { name: 'Model' })).toBeVisible();
  });

  test('switch between model and prompts sub-tabs', async ({ page }) => {
    await page.getByRole('button', { name: 'System Prompts' }).click();
    await expect(page).toHaveURL(/\/settings\/prompts$/);

    await page.getByRole('button', { name: 'Model' }).click();
    await expect(page).toHaveURL(/\/settings\/models$/);
  });

  test('prompts tab shows prompt editing area', async ({ page }) => {
    await page.getByRole('button', { name: 'System Prompts' }).click();

    // Should show the System Prompts heading and parse/chat prompt textareas
    await expect(page.getByText('System Prompts').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#parse-prompt')).toBeVisible();
    await expect(page.locator('#chat-prompt')).toBeVisible();
  });

  test('account tab NOT visible in OSS mode', async ({ page }) => {
    // In OSS (non-premium) mode, there should be no "Account" sub-tab
    await expect(page.getByRole('button', { name: 'Account' })).not.toBeVisible();
  });

  test('system prompt editing persists changes', async ({ page }) => {
    await page.getByRole('button', { name: 'System Prompts' }).click();

    // Edit the parse prompt
    const parsePrompt = page.locator('#parse-prompt');
    await expect(parsePrompt).toBeVisible({ timeout: 5_000 });
    await parsePrompt.fill('Custom parse prompt for testing');

    // Edit the chat prompt
    const chatPrompt = page.locator('#chat-prompt');
    await chatPrompt.fill('Custom chat prompt for testing');

    // Save
    await page.getByRole('button', { name: /Save Changes/i }).click();
    await expect(page.getByText('Saved!')).toBeVisible({ timeout: 5_000 });

    // Navigate away and back
    await navigateToTab(page, 'Library');
    await navigateToTab(page, 'Settings');
    await page.getByRole('button', { name: 'System Prompts' }).click();

    // Verify prompts persisted
    await expect(parsePrompt).toHaveValue('Custom parse prompt for testing', { timeout: 5_000 });
    await expect(chatPrompt).toHaveValue('Custom chat prompt for testing');
  });

  test('model tab lists gateway models and persists the selection', async ({ page }) => {
    // Mock the gateway catalog, then reload so AppShell fetches it.
    await mockModels(page);
    await page.reload();
    await waitForAppReady(page);
    await navigateToTab(page, 'Settings');
    await page.getByRole('button', { name: 'Model' }).click();
    await expect(page).toHaveURL(/\/settings\/models$/);

    // The single model picker is populated from /api/models (no provider dropdown).
    const modelSelect = page.getByRole('combobox', { name: 'Model' });
    await expect(modelSelect).toBeVisible();
    await expect(
      modelSelect.getByRole('option', { name: 'personal-ps-anthropic:claude-sonnet-4-6' })
    ).toBeAttached();
    await expect(
      modelSelect.getByRole('option', { name: 'personal-ps-anthropic:claude-haiku-4-5-20251001' })
    ).toBeAttached();

    // Selecting a model persists it as a plain string in localStorage.
    await modelSelect.selectOption('personal-ps-anthropic:claude-haiku-4-5-20251001');
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('porchsongs_model')))
      .toBe('personal-ps-anthropic:claude-haiku-4-5-20251001');

    // The choice survives a reload.
    await page.reload();
    await waitForAppReady(page);
    await navigateToTab(page, 'Settings');
    await page.getByRole('button', { name: 'Model' }).click();
    await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue(
      'personal-ps-anthropic:claude-haiku-4-5-20251001'
    );
  });
});
