// @ts-check
// Copies the self-hosted font into public/fonts and builds one SVG sprite of the Phosphor icons the site
// uses. Run after changing the icon list: npm run assets. The output is committed, so hosting needs no build.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read straight from node_modules: these packages don't export their package.json for resolving.
const modules = fileURLToPath(new URL('../node_modules/', import.meta.url));
const pub = new URL('../public/', import.meta.url);

/** Sprite id → Phosphor icon name (regular weight unless noted). */
const ICONS = {
  cart: 'shopping-bag-open', user: 'user-circle', search: 'magnifying-glass', menu: 'list', close: 'x',
  arrow: 'arrow-right', back: 'arrow-left', plus: 'plus', minus: 'minus', trash: 'trash', check: 'check',
  truck: 'truck', return: 'arrow-u-up-left', lock: 'lock-simple', tag: 'tag', warning: 'warning-circle',
  package: 'package', spark: 'sparkle', bug: 'bug', gauge: 'gauge', list: 'list-bullets', ticket: 'ticket',
  signout: 'sign-out', leaf: 'leaf', mountain: 'mountains', card: 'credit-card', chevron: 'caret-down',
  info: 'info', storefront: 'storefront', receipt: 'receipt',
};

async function main() {
  const fontDir = join(modules, '@fontsource-variable', 'geist', 'files');
  await mkdir(new URL('fonts/', pub), { recursive: true });
  for (const file of ['geist-latin-wght-normal.woff2', 'geist-latin-ext-wght-normal.woff2']) {
    await copyFile(join(fontDir, file), new URL(`fonts/${file}`, pub));
  }

  const iconDir = join(modules, '@phosphor-icons', 'core', 'assets', 'regular');
  const symbols = [];
  for (const [id, name] of Object.entries(ICONS)) {
    const svg = await readFile(join(iconDir, `${name}.svg`), 'utf8');
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 256 256';
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
    symbols.push(`<symbol id="${id}" viewBox="${viewBox}">${inner}</symbol>`);
  }
  await writeFile(new URL('icons.svg', pub),
    `<svg xmlns="http://www.w3.org/2000/svg">\n<!-- Phosphor Icons (MIT), https://phosphoricons.com -->\n${symbols.join('\n')}\n</svg>\n`);
  console.log(`Fonts copied; ${symbols.length} icons in public/icons.svg.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
