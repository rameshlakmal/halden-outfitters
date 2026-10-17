// Checkout journeys: a new customer from register to a confirmed order, a declined card, the bank step,
// cancelling from the order page, and a coupon.
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'a long walk in the woods';
const newEmail = () => `e2e-co-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** Registers through the UI and confirms the email from the fake inbox. */
async function newVerifiedCustomer(page: Page) {
  const email = newEmail();
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Rowan Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.goto(`/qa/inbox?email=${encodeURIComponent(email)}`);
  const link = page.locator('a[href*="verify-email?token="]').first();
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute('href'))!);
  await page.goto(href.pathname + href.search);
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  return email;
}

async function addToCart(page: Page, slug = 'camp-pillow') {
  await page.goto(`/products/${slug}`);
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible();
  await page.keyboard.press('Escape');
}

/** Fills the new-address form on the delivery step (the address book is empty for a new customer). */
async function deliveryWithNewAddress(page: Page) {
  await page.goto('/checkout');
  const form = page.getByRole('form', { name: 'New address' });
  await form.getByLabel('Full name').fill('Rowan Tester');
  await form.getByLabel('Address', { exact: true }).fill('9 Fir Road');
  await form.getByLabel('Postcode').fill('97401');
  await form.getByLabel('City').fill('Eugene');
  await form.getByLabel('Country').selectOption('US');
  await form.getByRole('button', { name: 'Use this address' }).click();
  await expect(page.getByTestId('method-standard')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to payment' }).click();
}

async function payWith(page: Page, number: string) {
  await page.getByLabel('Card number').fill(number);
  await page.getByLabel('Expiry').fill('12 / 30');
  await page.getByLabel('Security code').fill('123');
  await page.getByLabel('Name on card').fill('Rowan Tester');
  await page.getByRole('button', { name: 'Review order' }).click();
  await page.getByRole('button', { name: /Place order/ }).click();
}

test('a new customer checks out with a card that pays', async ({ page }) => {
  await newVerifiedCustomer(page);
  await addToCart(page);
  await deliveryWithNewAddress(page);
  await payWith(page, '4242 4242 4242 4242');

  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await expect(page.getByTestId('cart-button')).toHaveAccessibleName(/0 items|empty/i);

  await page.getByRole('link', { name: 'View order' }).click();
  await expect(page.getByText('Confirmed').first()).toBeVisible();
  await expect(page.getByTestId('payment-status')).toContainText('held on your card');

  // The new address went into the book.
  await page.goto('/account/addresses');
  await expect(page.getByText('9 Fir Road')).toBeVisible();
});

test('a declined card says so on the payment step and keeps what was typed', async ({ page }) => {
  await newVerifiedCustomer(page);
  await addToCart(page);
  await deliveryWithNewAddress(page);
  await payWith(page, '4000 0000 0000 0002');

  await expect(page.getByTestId('payment-error')).toBeVisible();
  await expect(page.getByLabel('Card number')).toHaveValue('4000 0000 0000 0002');
  await expect(page.getByLabel('Name on card')).toHaveValue('Rowan Tester');
  await expect(page).toHaveURL(/\/checkout$/);
});

test('the bank step: approve at the test bank and the order is confirmed', async ({ page }) => {
  await newVerifiedCustomer(page);
  await addToCart(page);
  await deliveryWithNewAddress(page);
  await payWith(page, '4000 0000 0000 3220');

  await expect(page).toHaveURL(/\/checkout\/authenticate\?token=/);
  await expect(page.getByText('HaldenPay test bank')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page).toHaveURL(/\/checkout\/confirmation\//);
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
});

test('cancelling an order from its page releases the hold', async ({ page }) => {
  await newVerifiedCustomer(page);
  await addToCart(page);
  await deliveryWithNewAddress(page);
  await payWith(page, '4242 4242 4242 4242');
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
  await page.getByRole('link', { name: 'View order' }).click();

  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this order' });
  // "Something else" needs a note.
  await dialog.getByLabel('Something else').check();
  await dialog.getByRole('button', { name: 'Cancel order' }).click();
  await expect(dialog.getByText('Tell us a little more.')).toBeVisible();
  await dialog.getByLabel('I changed my mind').check();
  await dialog.getByRole('button', { name: 'Cancel order' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
  await expect(page.getByTestId('payment-status')).toContainText('Nothing was charged');
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
});

test('a coupon on the cart shows as a discount line and carries into checkout', async ({ page }) => {
  await newVerifiedCustomer(page);
  await addToCart(page);
  await page.goto('/cart');
  await page.getByLabel('Discount code').fill('nosuchcode');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();

  await page.getByLabel('Discount code').fill('welcome10');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Discount (WELCOME10)')).toBeVisible();

  await page.goto('/checkout');
  // On phones the summary is folded away above the steps.
  if (test.info().project.name === 'mobile') {
    const fold = page.getByText('Order summary', { exact: true });
    await expect(fold).toBeVisible();
    await fold.click();
  }
  await expect(
    page
      .getByText(/WELCOME10/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
});
