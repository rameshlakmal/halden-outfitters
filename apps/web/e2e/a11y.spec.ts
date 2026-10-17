// Accessibility: axe-core (WCAG 2.2 A and AA rules) on the main pages, in both themes. Serious and critical
// problems fail the run; the rest are printed so they can be fixed over time.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const SHOPPER = process.env.SEED_SHOPPER_PASSWORD;

async function scan(page: Page, label: string) {
  // Let entrance motion settle so colours are measured at rest.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForLoadState('networkidle');
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const minor = result.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical');
  for (const v of minor) console.log(`[a11y] ${label}: ${v.id} (${v.impact}) x${v.nodes.length}`);
  const blocking = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')}) ${(v.nodes[0]?.failureSummary ?? '').replace(/\s+/g, ' ')}`,
    );
  // In CI, each problem becomes an annotation on the run, readable without opening the logs.
  if (process.env.CI) for (const b of blocking) console.log(`::error title=a11y ${label}::${b}`);
  expect(blocking, `${label}: serious accessibility problems`).toEqual([]);
}

const PUBLIC_PAGES = [
  ['home', '/'],
  ['shop', '/shop'],
  ['category', '/shop/shelter'],
  ['product', '/products/insulated-mug'],
  ['search', '/search?q=tent'],
  ['cart', '/cart'],
  ['sign in', '/sign-in'],
  ['register', '/register'],
  ['returns help', '/help/returns'],
] as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });
    for (const [label, path] of PUBLIC_PAGES) {
      test(`${label} has no serious accessibility problems`, async ({ page }) => {
        await page.goto(path);
        await scan(page, `${label} (${theme})`);
      });
    }
  });
}

test.describe('signed in', () => {
  test.skip(!SHOPPER, 'Set SEED_SHOPPER_PASSWORD to the password the demo data was seeded with.');

  test('account pages have no serious accessibility problems', async ({ page }) => {
    await page.goto('/sign-in?next=%2Faccount');
    await page.getByLabel('Email').fill('jonas@halden.test');
    await page.getByLabel('Password', { exact: true }).fill(SHOPPER!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);
    for (const path of [
      '/account',
      '/account/orders',
      '/account/returns',
      '/account/points',
      '/account/reviews',
      '/checkout',
    ]) {
      await page.goto(path);
      await scan(page, path);
    }
  });
});
