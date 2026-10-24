import { expect, type Page, test } from '@playwright/test';

export const PASSWORDS = {
  admin: process.env.SEED_ADMIN_PASSWORD,
  staff: process.env.SEED_STAFF_PASSWORD,
  shopper: process.env.SEED_SHOPPER_PASSWORD,
};

/** The read-only demo login's password is public (README, apps/api/scripts/seed-data.ts). */
export const VIEWER_PASSWORD = 'just-looking-around';

export function needPasswords() {
  test.skip(
    !PASSWORDS.admin || !PASSWORDS.staff,
    'Set SEED_ADMIN_PASSWORD and SEED_STAFF_PASSWORD to the passwords the demo data was seeded with.',
  );
}

/** Signs in through the form and lands on `next` (the admin's own redirect after sign-in). */
export async function signIn(page: Page, email: string, next = '/') {
  await page.goto(next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  const password = email.startsWith('admin@')
    ? PASSWORDS.admin
    : email.startsWith('viewer@')
      ? VIEWER_PASSWORD
      : email.startsWith('maya@') || email.startsWith('ari@')
        ? PASSWORDS.shopper
        : PASSWORDS.staff;
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replaceAll('/', '\\/').replaceAll('?', '\\?')}$`));
}
