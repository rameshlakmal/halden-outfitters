// Shopper journeys through the real UI and API.
import { expect, test } from '@playwright/test';

test.describe('browsing', () => {
  test('home shows categories and featured gear, and links into the shop', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Light enough to forget');
    await expect(page.getByRole('link', { name: /^Shelter/ }).first()).toBeVisible();
    await page.getByRole('link', { name: /Shop all gear/ }).click();
    await expect(page).toHaveURL(/\/shop$/);
    await expect(page.getByTestId('product-card')).toHaveCount(12);
  });

  test('filters live in the URL and narrow the grid', async ({ page }) => {
    await page.goto('/shop/kitchen');
    await expect(page.getByTestId('product-card')).toHaveCount(4);
    await page.getByRole('button', { name: 'On sale' }).click();
    await expect(page).toHaveURL(/onSale=true/);
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();
    await page
      .getByRole('button', { name: /Clear filters/ })
      .first()
      .click();
    await expect(page.getByTestId('product-card')).toHaveCount(4);
  });

  test('sorting by price puts the cheapest first', async ({ page }) => {
    await page.goto('/shop?sort=price-asc');
    await expect(page.getByTestId('product-card').first()).toContainText('Insulated Mug');
  });

  test('"Show more" loads the next page without repeats', async ({ page }) => {
    await page.goto('/shop');
    await page.getByRole('button', { name: 'Show more' }).click();
    await expect(page.getByTestId('product-card')).toHaveCount(16);
    await expect(page.getByText('Showing 16 of 16')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  });

  test('search palette finds products as you type', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard shortcut is a desktop feature');
    await page.goto('/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search products' }).fill('hamm');
    await page.getByRole('option', { name: /Drift Hammock/ }).click();
    await expect(page).toHaveURL(/\/products\/drift-hammock$/);
  });

  test('product page shows stock, final-sale notes and related gear', async ({ page }) => {
    await page.goto('/products/drift-hammock');
    await expect(page.getByText('Only 3 left').first()).toBeVisible();
    await page.goto('/products/water-filter');
    await expect(page.getByText(/Final sale/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /More camp kitchen/ })).toBeVisible();
  });

  test('a sold-out product cannot be added', async ({ page }) => {
    await page.goto('/products/loft-sleeping-pad');
    await expect(page.getByRole('button', { name: 'Sold out' })).toBeDisabled();
  });

  test('unknown pages get the 404 page', async ({ page }) => {
    for (const path of ['/products/no-such-thing', '/shop/no-such-category', '/no-such-page']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    await expect(page.getByText('Off the map')).toBeVisible();
  });
});

test.describe('cart', () => {
  test('add, change quantity and remove, in the drawer and on the cart page', async ({ page }) => {
    await page.goto('/products/ember-stove');
    await page.getByTestId('add-to-cart').click();
    const drawer = page.getByRole('dialog', { name: 'Your cart' });
    await expect(drawer.getByText('Ember Stove')).toBeVisible();
    await drawer.getByRole('button', { name: 'One more' }).click();
    await expect(drawer.getByText('138.00').first()).toBeVisible();
    await expect(page.getByTestId('cart-button')).toHaveAccessibleName(/2 items/);
    await drawer.getByRole('link', { name: 'View cart' }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByTestId('cart-subtotal')).toHaveText('138.00');
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });

  test('cannot add more than is in stock', async ({ page }) => {
    await page.goto('/products/drift-hammock'); // 3 in stock
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'One more' }).click();
    // The stepper stops at the stock level.
    await expect(page.getByRole('button', { name: 'One more' })).toBeDisabled();
  });
});
