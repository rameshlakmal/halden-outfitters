// Reviews with the seeded demo data: Jonas reviewed the insulated mug (5 stars), Maya's camp pillow review is
// held for moderation (it has a link), and Maya reviewed the tent she received.
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = process.env.SEED_SHOPPER_PASSWORD;

async function signIn(page: Page, email: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/#]/g, '.')}$`));
}

test('the product page shows the rating summary and reviews', async ({ page }) => {
  await page.goto('/products/insulated-mug#reviews');
  const section = page.locator('#reviews');
  await expect(section.getByTestId('rating-average')).toHaveText('5.0');
  await expect(section.getByTestId('rating-count')).toHaveText('1 review');
  const card = section.getByTestId('review-card').filter({ hasText: 'Coffee still hot at the summit' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Jonas L.')).toBeVisible();
  await expect(card.getByText('Verified buyer')).toBeVisible();
  // Signed out, the helpful button asks you to sign in.
  await card.getByRole('button', { name: /Helpful/ }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test.describe('signed in', () => {
  test.skip(!PASSWORD, 'Set SEED_SHOPPER_PASSWORD to the password the demo data was seeded with.');

  test("Maya marks Jonas's review helpful", async ({ page }) => {
    await signIn(page, 'maya@halden.test', '/products/insulated-mug');
    const card = page
      .locator('#reviews')
      .getByTestId('review-card')
      .filter({ hasText: 'Coffee still hot at the summit' });
    const button = card.getByRole('button', { name: /Helpful/ });
    await expect(button).toHaveText(/\(0\)/);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveText(/\(1\)/);
    // Still counted after a reload: the vote was saved.
    await page.reload();
    await expect(
      page
        .locator('#reviews')
        .getByTestId('review-card')
        .filter({ hasText: 'Coffee still hot' })
        .getByRole('button', { name: /Helpful/ }),
    ).toHaveText(/\(1\)/);
    // Undo, so the test can run again.
    await page
      .locator('#reviews')
      .getByRole('button', { name: /Helpful/ })
      .first()
      .click();
  });

  test('her reviews page shows the held camp pillow review', async ({ page }) => {
    await signIn(page, 'maya@halden.test', '/account/reviews');
    const pillow = page.getByTestId('my-review').filter({ hasText: 'Too flat for side sleepers' });
    await expect(pillow.getByTestId('review-status')).toHaveText('Waiting for a check');
    await expect(pillow.getByText(/contains a link/)).toBeVisible();
    const tent = page.getByTestId('my-review').filter({ hasText: 'Solid in the wind' });
    await expect(tent.getByTestId('review-status')).toHaveText('Published');
  });
});
