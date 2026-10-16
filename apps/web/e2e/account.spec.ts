// Account journeys: register, confirm through the fake inbox, addresses, devices, sign out and back in.
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'a long walk in the woods';
const newEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function register(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Rowan Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test('register keeps the browser cart and asks for email confirmation', async ({ page }) => {
  await page.goto('/products/camp-pillow');
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible();
  await page.keyboard.press('Escape');

  await register(page, newEmail());
  await expect(page.getByText(/Please confirm/)).toBeVisible();
  await expect(page.getByTestId('cart-button')).toHaveAccessibleName(/1 item/);
});

test('a weak password is refused next to the field', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Rowan Tester');
  await page.getByLabel('Email').fill(newEmail());
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('This password is too common. Choose something harder to guess.')).toBeVisible();
});

test('the confirmation link from the fake inbox confirms the email', async ({ page }) => {
  const email = newEmail();
  await register(page, email);
  await page.goto(`/qa/inbox?email=${encodeURIComponent(email)}`);
  const link = page.locator('a[href*="verify-email?token="]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  await page.goto(new URL(href).pathname + new URL(href).search);
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  await page.goto('/account');
  await expect(page.getByText(/Please confirm/)).toHaveCount(0);
});

test('address book: the first address becomes the default', async ({ page }) => {
  await register(page, newEmail());
  await page.goto('/account/addresses');
  await page.getByRole('button', { name: 'Add address' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Full name').fill('Rowan Tester');
  await form.getByLabel('Address', { exact: true }).fill('9 Fir Road');
  await form.getByLabel('Postcode').fill('97401');
  await form.getByLabel('City').fill('Eugene');
  await form.getByLabel('Country').selectOption('US');
  await form.getByRole('button', { name: 'Add address' }).click();
  await expect(page.getByText('Default', { exact: true })).toBeVisible();
  await expect(page.getByText('9 Fir Road')).toBeVisible();
});

test('signed out, the account area sends you to sign in and back', async ({ page }) => {
  const email = newEmail();
  await register(page, email);
  await page
    .getByRole('button', { name: /sign out/i })
    .first()
    .click();
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fsecurity/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('That email and password do not match.')).toBeVisible();

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByText('This device')).toBeVisible();
});

test('sign-in refuses to redirect to another site', async ({ page }) => {
  const email = newEmail();
  await register(page, email);
  await page
    .getByRole('button', { name: /sign out/i })
    .first()
    .click();
  await page.goto('/sign-in?next=//evil.example/steal');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/localhost:\d+\/account$/);
});
