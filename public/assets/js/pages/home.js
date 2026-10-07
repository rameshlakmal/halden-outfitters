import { api, esc, icon, initPage, productCard, productSkeletons, reveal, wireQuickAdd } from '../core.js';

/** The photo for each category tile: the category's best-known product. */
const TILE_IMAGE = {
  shelter: '/images/products/ridgeline-2p-tent.jpg',
  sleep: '/images/products/alpine-down-bag.jpg',
  kitchen: '/images/products/ember-stove.jpg',
  carry: '/images/products/summit-45l-pack.jpg',
};

initPage();

const cats = document.querySelector('[data-categories]');
const featured = document.querySelector('[data-featured]');
featured.innerHTML = productSkeletons(4);
wireQuickAdd(featured);

api('GET', '/categories').then((list) => {
  cats.innerHTML = list.map((c) => `
    <a class="cat-tile" href="/shop?category=${esc(c.slug)}" data-reveal>
      <img src="${esc(TILE_IMAGE[c.slug] ?? '')}" alt="" loading="lazy">
      <span class="cat-label"><strong>${esc(c.name)}</strong><span>${c.productCount} products ${icon('arrow')}</span></span>
    </a>`).join('');
  reveal(cats);
}).catch(() => { cats.innerHTML = ''; });

api('GET', '/products?featured=1').then((list) => {
  featured.innerHTML = list.slice(0, 4).map(productCard).join('');
  reveal(featured);
}).catch((err) => {
  featured.innerHTML = `<p class="callout callout-bad">${esc(err.message)}</p>`;
});
