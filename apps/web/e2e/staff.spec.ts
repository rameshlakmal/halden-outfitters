// The staff console with the seeded demo data: Ari's newest order is confirmed (ready to pack), and Maya's
// camp pillow review is held for moderation because it has a link.
import { expect, type Page, test } from '@playwright/test';

const ADMIN = process.env.SEED_ADMIN_PASSWORD;
const STAFF = process.env.SEED_STAFF_PASSWORD;
test.skip(
  !ADMIN || !STAFF,
  'Set SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD to the passwords the demo data was seeded with.',
);

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill((email.startsWith('admin@') ? ADMIN : STAFF)!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace('/', '\\/')}$`));
}

test('signed out, the console sends you to sign in', async ({ page }) => {
  await page.goto('/staff/orders');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fstaff%2Forders/);
});

test('the warehouse packs the confirmed order from its queue', async ({ page }) => {
  await signIn(page, 'warehouse@halden.test', '/staff/warehouse');
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  const row = page.getByTestId('pack-row').filter({ hasText: 'ari@halden.test' });
  await expect(row).toHaveCount(1);
  const id = (await row.getByRole('link').first().textContent())!.replace('#', '');
  await row.getByRole('button', { name: 'Mark packed' }).click();
  await expect(page.getByTestId('ship-row').filter({ hasText: `#${id}` })).toBeVisible();
  await expect(page.getByTestId('pack-row').filter({ hasText: `#${id}` })).toHaveCount(0);
});

test('support publishes the held camp pillow review', async ({ page }) => {
  await signIn(page, 'support@halden.test', '/staff/reviews');
  const held = page.getByTestId('moderation-review').filter({ hasText: 'Camp Pillow' }).filter({ hasText: 'Held' });
  await expect(held).toHaveCount(1);
  await expect(held).toContainText('Maya');
  await held.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('moderation-review').filter({ hasText: 'Too flat for side sleepers' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Published' }).click();
  await expect(page.getByTestId('moderation-review').filter({ hasText: 'Too flat for side sleepers' })).toBeVisible();
});

test('admin switches a planted bug on and off, and the audit log shows it', async ({ page }) => {
  await signIn(page, 'admin@halden.test', '/qa');
  const bug = page.getByTestId('bug-coupon_twice');
  const toggle = bug.getByRole('switch');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  await page.goto('/staff/audit');
  const rows = page.getByTestId('audit-row');
  await expect(rows.filter({ hasText: 'qa.bug_off' }).first()).toContainText('coupon_twice');
  await expect(rows.filter({ hasText: 'qa.bug_on' }).first()).toContainText('coupon_twice');
});

test('a customer sees that the console is for staff', async ({ page }) => {
  const shopper = process.env.SEED_SHOPPER_PASSWORD;
  test.skip(!shopper, 'Set SEED_SHOPPER_PASSWORD too.');
  await page.goto('/sign-in?next=%2Fstaff');
  await page.getByLabel('Email').fill('ari@halden.test');
  await page.getByLabel('Password', { exact: true }).fill(shopper!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Staff only' })).toBeVisible();
});
