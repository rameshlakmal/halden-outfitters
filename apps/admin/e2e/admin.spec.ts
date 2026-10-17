// The admin's own screens: the dashboard, search, coupons, theme, and the phone menu.
import { expect, test } from '@playwright/test';
import { needPasswords, signIn } from './helpers';

needPasswords();

test('signed out, any page sends you to sign in and back', async ({ page }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Forders/);
});

test('the dashboard shows the period, its charts, and switches range', async ({ page }) => {
  await signIn(page, 'admin@halden.test');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Revenue', { exact: true })).toBeVisible();
  for (const chart of ['Revenue per day', 'Orders per day', 'Orders by status']) {
    await expect(page.getByRole('heading', { name: chart })).toBeVisible();
  }
  await expect(page.getByRole('img', { name: /^Revenue per day over the last 30 days/ })).toBeVisible();
  await page.getByRole('button', { name: '7 days' }).click();
  await expect(page.getByText('Shop time, last 7 days')).toBeVisible();
  await expect(page.getByRole('img', { name: /^Revenue per day over the last 7 days/ })).toBeVisible();
});

test('Ctrl+K jumps to a section and opens an order by its number', async ({ page }) => {
  await signIn(page, 'admin@halden.test');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Go to a section, or type an order number').fill('coupons');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/coupons$/);
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Go to a section, or type an order number').fill('100001');
  await page.getByRole('option', { name: 'Open order #100001' }).click();
  await expect(page.getByRole('heading', { name: 'Order #100001' })).toBeVisible();
});

test('an admin creates a coupon, then switches it off', async ({ page }) => {
  await signIn(page, 'admin@halden.test', '/coupons');
  const code = `E2E${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: 'New coupon' }).click();
  const dialog = page.getByRole('dialog', { name: 'New coupon' });
  await dialog.getByLabel('Code').fill(code);
  await dialog.getByLabel('Percent off (1 to 100)').fill('12');
  await dialog.getByLabel('Description (staff only)').fill('Made by the end-to-end test');
  await dialog.getByLabel('Uses per customer').fill('1');
  await dialog.getByRole('button', { name: 'Create coupon' }).click();
  const row = page.getByTestId('coupon-row').filter({ hasText: code });
  await expect(row).toContainText('12% off');
  await expect(row).toContainText('Live');
  await row.getByRole('switch').uncheck();
  await expect(row).toContainText('Off');
});

test('the coupon form explains a code that is taken', async ({ page }) => {
  await signIn(page, 'admin@halden.test', '/coupons');
  await page.getByRole('button', { name: 'New coupon' }).click();
  const dialog = page.getByRole('dialog', { name: 'New coupon' });
  await dialog.getByLabel('Code').fill('WELCOME10');
  await dialog.getByLabel('Percent off (1 to 100)').fill('10');
  await dialog.getByLabel('Description (staff only)').fill('A copy');
  await dialog.getByRole('button', { name: 'Create coupon' }).click();
  await expect(dialog.getByText('There is already a coupon with this code.')).toBeVisible();
});

test('the theme choice is remembered', async ({ page }) => {
  await signIn(page, 'admin@halden.test');
  const before = await page.evaluate(() => document.documentElement.dataset.theme ?? null);
  await page.getByRole('button', { name: /Use (dark|light) mode/ }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(after).not.toBe(before);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
});

test('on a phone, the sections are in a slide-in menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'admin@halden.test');
  await page.getByRole('button', { name: 'Open the menu' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Products' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
});

test('an admin adds a product, and it has its stock', async ({ page }) => {
  await signIn(page, 'admin@halden.test', '/products');
  await page.getByRole('link', { name: 'New product' }).click();
  await expect(page.getByRole('heading', { name: 'New product' })).toBeVisible();
  const n = Date.now().toString().slice(-6);
  await page.getByLabel('Name').fill(`Trail Lantern ${n}`);
  await expect(page.getByLabel('Address')).toHaveValue(`trail-lantern-${n}`);
  await page.getByLabel('SKU').fill(`HO-LAMP${n}`);
  await page.getByLabel('Category').selectOption({ label: 'Camp kitchen' });
  await page.getByLabel('Summary (one sentence, shown on cards)').fill('A rechargeable lantern for the camp table.');
  await page.getByLabel('Description').fill('Warm light for four hours on high, twenty on low. Charges over USB-C.');
  await page.getByLabel('Detail 1 label').fill('Weight');
  await page.getByLabel('Detail 1 value').fill('240 g');
  // No Blob store in tests: use a photo the shop already has.
  await page.getByLabel('Photo path on the shop').fill('/images/products/headlamp-400.jpg');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Price', { exact: true }).fill('39');
  await page.getByLabel('Opening stock').fill('12');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.getByRole('heading', { name: `Trail Lantern ${n}` })).toBeVisible();
  await expect(page.getByText('12', { exact: true }).first()).toBeVisible();
});

test('the new product form explains a taken SKU', async ({ page }) => {
  await signIn(page, 'admin@halden.test', '/products/new');
  await page.getByLabel('Name').fill('Second Tent');
  await page.getByLabel('SKU').fill('HO-RIDGELINE2');
  await page.getByLabel('Category').selectOption({ label: 'Shelter' });
  await page.getByLabel('Summary (one sentence, shown on cards)').fill('A tent with a taken stock code.');
  await page.getByLabel('Description').fill('This one should be refused because the SKU is used.');
  await page.getByLabel('Photo path on the shop').fill('/images/products/ridgeline-2p-tent.jpg');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Price', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Add product' }).click();
  await expect(page.getByText('Another product already has this SKU.')).toBeVisible();
});
