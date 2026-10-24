// The public read-only login: it sees the sections without customer details, and every save is refused.
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('the viewer sees the safe sections and a read-only banner', async ({ page }) => {
  await signIn(page, 'viewer@halden.test');
  await expect(page.getByRole('status').filter({ hasText: 'Read-only demo account' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Sections' });
  for (const section of ['Dashboard', 'Products', 'Coupons', 'Settings', 'QA lab']) {
    await expect(nav.getByRole('link', { name: section })).toBeVisible();
  }
  for (const section of ['Orders', 'Warehouse', 'Returns', 'Reviews', 'Customers', 'Audit log']) {
    await expect(nav.getByRole('link', { name: section })).toHaveCount(0);
  }
});

test('the viewer reads the QA lab but switching a bug on is refused', async ({ page }) => {
  await signIn(page, 'viewer@halden.test', '/qa');
  const bug = page.getByTestId('bug-coupon_twice');
  await expect(bug.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('heading', { name: 'Payment webhooks' })).toHaveCount(0);

  await bug.getByRole('switch').click();
  await expect(page.getByText(/read-only demo account/)).toBeVisible();
  await expect(bug.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
});
