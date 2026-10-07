import { addToCart, api, esc, icon, initPage, money, params, productCard, reveal, stockBadge, wireQuickAdd } from '../core.js';

initPage();

const root = document.querySelector('[data-product]');
const slug = params.get('slug') ?? '';

function stockLine(stock) {
  if (stock === 0) return `<span class="badge badge-bad">${icon('warning')} Sold out</span>`;
  if (stock <= 5) return stockBadge(stock);
  return `<span class="badge badge-good">${icon('check')} In stock</span>`;
}

async function load() {
  let p;
  try {
    p = await api('GET', `/products/${encodeURIComponent(slug)}`);
  } catch (err) {
    root.innerHTML = `<div class="empty" style="margin-top:48px">${icon('package')}<h1 style="font-size:1.5rem">${err.status === 404 ? 'We couldn’t find that product' : 'Something went wrong'}</h1>
      <p class="muted">${esc(err.status === 404 ? 'It may have been renamed or retired.' : err.message)}</p><a class="btn" href="/shop">Browse all gear</a></div>`;
    return;
  }
  document.title = `${p.name} · Halden Outfitters`;
  const max = Math.min(p.stock, 20);
  root.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb" style="padding-top:28px">
      <a href="/">Home</a><span aria-hidden="true">/</span><a href="/shop?category=${esc(p.category)}">${esc(p.categoryName)}</a><span aria-hidden="true">/</span><span>${esc(p.name)}</span>
    </nav>
    <div class="pdp">
      <div class="pdp-media"><img src="${esc(p.image)}" alt="${esc(p.name)}" width="1200" height="1200"></div>
      <div class="pdp-info">
        <div style="display:grid;gap:10px">
          <h1 style="font-size:clamp(2rem,3.4vw,2.75rem)">${esc(p.name)}</h1>
          <p class="lead">${esc(p.summary)}</p>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <span class="pdp-price">${money(p.price)}</span>${stockLine(p.stock)}
        </div>
        ${p.stock > 0 ? `
        <div class="buy-row">
          <div class="stepper" role="group" aria-label="Quantity">
            <button type="button" data-step="-1" aria-label="One fewer" disabled>${icon('minus')}</button>
            <output aria-live="polite">1</output>
            <button type="button" data-step="1" aria-label="One more" ${max <= 1 ? 'disabled' : ''}>${icon('plus')}</button>
          </div>
          <button class="btn" type="button" data-buy>${icon('cart')} Add to cart</button>
        </div>` : `<div class="callout">${icon('info')} Sold out for now. Check back after the next restock.</div>`}
        <div class="ship-note">
          <div>${icon('truck')} Free shipping on orders over $75, otherwise $7.95.</div>
          <div>${icon('return')} Cancel before it ships for a full refund.</div>
        </div>
        <p style="color:var(--ink-2)">${esc(p.description)}</p>
        <dl class="specs">${p.details.map(([k, v]) => `<div class="spec"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      </div>
    </div>`;

  let qty = 1;
  const out = root.querySelector('output');
  root.querySelectorAll('[data-step]').forEach((btn) => btn.addEventListener('click', () => {
    qty = Math.max(1, Math.min(max, qty + Number(btn.dataset.step)));
    out.textContent = String(qty);
    root.querySelector('[data-step="-1"]').disabled = qty <= 1;
    root.querySelector('[data-step="1"]').disabled = qty >= max;
  }));
  root.querySelector('[data-buy]')?.addEventListener('click', (e) => addToCart(p.id, qty, e.currentTarget));

  if (p.related.length) {
    const section = document.querySelector('[data-related-section]');
    const grid = document.querySelector('[data-related]');
    section.hidden = false;
    grid.innerHTML = p.related.map(productCard).join('');
    wireQuickAdd(grid);
    reveal(grid);
  }
}

load();
