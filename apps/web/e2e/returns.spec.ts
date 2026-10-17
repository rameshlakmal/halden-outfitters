// Returns, points and store credit with the seeded demo data: Jonas has a delivered order from 6 days ago with
// two camp pillows (final sale) and one insulated mug (returnable).
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = process.env.SEED_SHOPPER_PASSWORD;
test.skip(!PASSWORD, 'Set SEED_SHOPPER_PASSWORD to the password the demo data was seeded with.');

async function signInAsJonas(page: Page) {
  await page.goto('/sign-in?next=%2Faccount%2Forders');
  await page.getByLabel('Email').fill('jonas@halden.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account\/orders$/);
}

test('return a damaged mug: approved with a label, then cancelled', async ({ page }) => {
  await signInAsJonas(page);
  // Jonas has one delivered order (the other one is still on its way).
  const delivered = page.getByTestId('order-card').filter({ hasText: 'Delivered' });
  await expect(delivered).toHaveCount(1);
  await delivered.click();
  await expect(page).toHaveURL(/\/account\/orders\/\d+$/);
  await expect(page.getByTestId('return-by')).toBeVisible();
  await page.getByTestId('start-return').click();
  await expect(page).toHaveURL(/\/return$/);

  // Step 1: the pillows are final sale, the mug can go back.
  const pillow = page.getByTestId('return-line').filter({ hasText: 'Camp Pillow' });
  await expect(pillow.getByText('Final sale')).toBeVisible();
  await expect(pillow.getByRole('checkbox')).toBeDisabled();
  await page.getByTestId('return-line').filter({ hasText: 'Mug' }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: a shop-fault reason gets a free label.
  await page.getByTestId('reason-damaged').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: review and send.
  await expect(page.getByText('Free', { exact: true })).toBeVisible();
  await expect(page.getByTestId('return-estimate')).toBeVisible();
  await page.getByRole('button', { name: 'Send return request' }).click();

  await expect(page).toHaveURL(/\/account\/returns\/\d+$/);
  await expect(page.getByTestId('return-status')).toHaveText(/Approved/i);
  await expect(page.getByTestId('label-code')).toHaveText(/^HRL-/);

  await page.getByRole('button', { name: 'Cancel return' }).click();
  await page.getByRole('dialog', { name: 'Cancel this return' }).getByRole('button', { name: 'Cancel return' }).click();
  await expect(page.getByTestId('return-status')).toHaveText(/Cancelled/i);

  await page.goto('/account/returns');
  await expect(page.getByTestId('return-card').first()).toContainText('Cancelled');
});

test('points and store credit pages show balances and how they work', async ({ page }) => {
  await signInAsJonas(page);
  await page.goto('/account/points');
  await expect(page.getByRole('heading', { name: 'Halden Points' })).toBeVisible();
  await expect(page.getByTestId('points-available')).toBeVisible();
  await expect(page.getByTestId('points-pending')).toBeVisible();
  await expect(page.getByText('Every 100 points take $5.00 off')).toBeVisible();

  await page.goto('/account/store-credit');
  await expect(page.getByRole('heading', { name: 'Store credit' })).toBeVisible();
  await expect(page.getByTestId('credit-balance')).toHaveText(/\d+\.\d{2}/);
});
