// Accessibility: axe-core (WCAG 2.2 A and AA rules) on every section, in both themes. Serious and critical problems
// fail the run; the rest are printed so they can be fixed over time.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { needPasswords, signIn } from './helpers';

needPasswords();

async function scan(page: Page, label: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForLoadState('networkidle');
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  for (const v of result.violations.filter((v) => v.impact !== 'serious' && v.impact !== 'critical')) {
    console.log(`[a11y] ${label}: ${v.id} (${v.impact}) x${v.nodes.length}`);
  }
  const blocking = result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')})`,
    );
  if (process.env.CI) for (const b of blocking) console.log(`::error title=a11y ${label}::${b}`);
  expect(blocking, `${label}: serious accessibility problems`).toEqual([]);
}

const PAGES = [
  '/',
  '/orders',
  '/warehouse',
  '/returns',
  '/reviews',
  '/products',
  '/products/new',
  '/coupons',
  '/customers',
  '/settings',
  '/audit',
  '/qa',
];

for (const theme of ['light', 'dark'] as const) {
  test(`every section has no serious accessibility problems (${theme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page, 'admin@halden.test');
    for (const path of PAGES) {
      await page.goto(path);
      await page.getByRole('heading', { level: 1 }).first().waitFor();
      await scan(page, `${path} (${theme})`);
    }
  });
}

test('sign-in has no serious accessibility problems', async ({ page }) => {
  await page.goto('/sign-in');
  await scan(page, '/sign-in');
});
