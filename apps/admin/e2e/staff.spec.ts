// Staff work with the seeded demo data: Ari's newest order is confirmed (ready to pack), and Maya's camp pillow
// review is held for moderation because it has a link. These change the demo data, so this file runs last.
import { expect, test } from '@playwright/test';
import { needPasswords, PASSWORDS, signIn } from './helpers';

needPasswords();

test('the warehouse packs the confirmed order from its queue, and sees only its sections', async ({ page }) => {
  await signIn(page, 'warehouse@halden.test', '/warehouse');
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Settings' })).toHaveCount(
    0,
  );
  const row = page.getByTestId('pack-row').filter({ hasText: 'ari@halden.test' });
  await expect(row).toHaveCount(1);
  const id = (await row.getByRole('link').first().textContent())!.replace('#', '');
  await row.getByRole('button', { name: 'Mark packed' }).click();
  await expect(page.getByTestId('ship-row').filter({ hasText: `#${id}` })).toBeVisible();
  await expect(page.getByTestId('pack-row').filter({ hasText: `#${id}` })).toHaveCount(0);
});

test('support publishes the held camp pillow review', async ({ page }) => {
  await signIn(page, 'support@halden.test', '/reviews');
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
  const toggle = page.getByTestId('bug-coupon_twice').getByRole('switch');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled(); // saved: the switch takes the next click
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();

  await page.goto('/audit');
  const rows = page.getByTestId('audit-row');
  await expect(rows.filter({ hasText: 'qa.bug_off' }).first()).toContainText('coupon_twice');
  await expect(rows.filter({ hasText: 'qa.bug_on' }).first()).toContainText('coupon_twice');
});

test('a customer sees that the admin is for staff', async ({ page }) => {
  test.skip(!PASSWORDS.shopper, 'Set SEED_SHOPPER_PASSWORD too.');
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill('ari@halden.test');
  await page.getByLabel('Password').fill(PASSWORDS.shopper!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'This is the staff admin' })).toBeVisible();
});
