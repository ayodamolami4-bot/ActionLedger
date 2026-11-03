import {test, expect} from '@playwright/test';

// Local simulation only. These tests do not move funds or send emails.
// Run serially against the single local SQLite instance started by Playwright.
test('standalone console: approval, execution, receipts, and replay', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const current = await page.request.get('http://127.0.0.1:4400/actions');
  expect(current.ok()).toBeTruthy();
  const before = (await current.json()).actions.length;
  const key = `ci-refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await page.goto('http://127.0.0.1:4400/console');
  await expect(page.getByRole('heading', {name: 'Every action has a boundary.'})).toBeVisible();
  await expect(page.locator('#total')).toHaveText(String(before));
  await page.locator('#tool').selectOption('issue_refund');
  await page.locator('#request-id').fill(key);
  await page.locator('#create').click();

  await expect(page.locator('#total')).toHaveText(String(before + 1));
  await expect(page.locator('#detail')).toContainText('Needs review');
  await expect(page.locator('#detail')).toContainText('Verified');
  // Regression: a refresh during a busy operation must not leave review controls disabled.
  await expect(page.locator('#detail').getByRole('button', {name: 'Approve'})).toBeEnabled();
  await page.locator('#detail').getByRole('button', {name: 'Approve'}).click();
  await expect(page.locator('#detail')).toContainText('Ready');
  await page.locator('#run').click();
  await expect(page.locator('#detail')).toContainText('Completed');
  await expect(page.locator('#detail')).toContainText('Verified');

  await page.screenshot({path: 'artifacts/standalone-workflow.png', fullPage: true});
  await page.locator('#create').click();
  await expect(page.locator('#notice')).toContainText('Idempotent replay');
  await expect(page.locator('#total')).toHaveText(String(before + 1));
  expect(errors).toEqual([]);
});

test('React console: independent approval and verified execution', async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const current = await page.request.get('http://127.0.0.1:4400/actions');
  expect(current.ok()).toBeTruthy();
  const before = (await current.json()).actions.length;

  await page.goto('http://127.0.0.1:5173/');
  await expect(page.getByRole('heading', {name: 'Every action has a boundary.'})).toBeVisible();
  await expect(page.locator('.action-list button.action')).toHaveCount(before);

  await page.getByLabel('Tool').selectOption('issue_refund');
  await page.getByRole('button', {name: /Create request/}).click();
  await expect(page.locator('.action-list button.action')).toHaveCount(before + 1);
  // Queue renders newest-first. Select the just-created pending item, not the oldest entry.
  await page.locator('.action-list button.action').filter({hasText: 'Needs review'}).first().click();
  await expect(page.locator('.detail')).toContainText('Needs review');
  await page.locator('.detail').getByRole('button', {name: 'Approve'}).click();
  await expect(page.locator('.detail')).toContainText('Ready');
  await page.getByRole('button', {name: 'Run worker once'}).click();
  await expect(page.locator('.detail')).toContainText('Completed');
  await expect(page.locator('.detail')).toContainText('Verified');

  await page.screenshot({path: 'artifacts/react-workflow.png', fullPage: true});
  expect(errors).toEqual([]);
});
