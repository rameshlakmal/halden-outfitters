// Shared by every page: API calls, the header and footer, money, toasts, product cards.

export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields ?? {};
  }
}

/** Calls the shop API. Throws ApiError with the server's message. */
export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error?.message ?? 'Something went wrong. Please try again.', data.error?.fields);
  return data;
}

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** "84.50" → "$84.50" */
export const money = (amount) => MONEY.format(Number(amount));

/** Escapes text for HTML. Every value from the API goes through this before reaching innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/icons.svg#${name}"></use></svg>`;

export const params = new URLSearchParams(location.search);

export function formatDate(iso, withTime = false) {
  return new Date(iso).toLocaleDateString('en-US', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- session state ----------

let me = null;
/** The signed-in customer, or null. Loaded once per page. */
export async function currentCustomer() {
  if (me === null) me = api('GET', '/me').then((d) => d.customer).catch(() => null);
  return me;
}

export function setCartCount(count, bump = false) {
  const el = document.querySelector('.cart-count');
  if (!el) return;
  el.textContent = count > 0 ? String(count) : '';
  el.closest('a')?.setAttribute('aria-label', count > 0 ? `Cart, ${count} item${count === 1 ? '' : 's'}` : 'Cart, empty');
  if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

// ---------- toasts ----------

export function toast(message, { link, bad = false } = {}) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.innerHTML = `${icon(bad ? 'warning' : 'check')}<span>${esc(message)}</span>${link ? `<a href="${esc(link.href)}">${esc(link.label)}</a>` : ''}`;
  host.append(el);
  setTimeout(() => el.remove(), 4200);
}

// ---------- add to cart ----------

export async function addToCart(productId, qty = 1, button) {
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Adding'; }
  try {
    const cart = await api('POST', '/cart/items', { productId: Number(productId), qty });
    setCartCount(cart.count, true);
    toast('Added to your cart.', { link: { href: '/cart', label: 'View cart' } });
    if (button) button.innerHTML = `${icon('check')} Added`;
    setTimeout(() => { if (button) { button.innerHTML = label; button.disabled = false; } }, 1400);
  } catch (err) {
    toast(err.message, { bad: true });
    if (button) { button.innerHTML = label; button.disabled = false; }
  }
}

// ---------- product card ----------

export function stockBadge(stock) {
  if (stock === 0) return '<span class="badge badge-bad">Sold out</span>';
  if (stock <= 5) return `<span class="badge badge-warn">Only ${stock} left</span>`;
  return '';
}

export function productCard(p) {
  const href = `/product?slug=${encodeURIComponent(p.slug)}`;
  return `
    <article class="product-card" data-reveal>
      <div class="media">
        <img src="${esc(p.image)}" alt="" loading="lazy" width="600" height="600">
        ${p.stock <= 5 ? `<span class="stock-note">${stockBadge(p.stock)}</span>` : ''}
      </div>
      <div class="info">
        <div class="meta">
          <a class="name" href="${href}">${esc(p.name)}</a>
          <span class="price">${money(p.price)}</span>
        </div>
        <span class="muted small">${esc(p.categoryName)}</span>
      </div>
      ${p.stock > 0 ? `<button class="btn btn-sm quick-add" type="button" data-add="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">${icon('plus')} Add</button>` : ''}
    </article>`;
}

export function productSkeletons(n) {
  return Array.from({ length: n }, () => `
    <div class="product-card" aria-hidden="true">
      <div class="skeleton media"></div>
      <div class="skeleton line" style="width:70%"></div>
      <div class="skeleton line" style="width:40%"></div>
    </div>`).join('');
}

/** Quick-add buttons inside `root` add to the cart without leaving the page. */
export function wireQuickAdd(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    e.preventDefault();
    addToCart(btn.dataset.add, 1, btn);
  });
}

// ---------- reveal on scroll ----------

const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -8% 0px' })
  : null;

/** Fades in new [data-reveal] elements as they scroll into view (instantly with reduced motion). */
export function reveal(root = document) {
  for (const el of root.querySelectorAll('[data-reveal]:not(.in)')) {
    if (observer) observer.observe(el); else el.classList.add('in');
  }
}

// ---------- header and footer ----------

const NAV = [
  ['Shop all', '/shop'],
  ['Shelter', '/shop?category=shelter'],
  ['Sleep', '/shop?category=sleep'],
  ['Camp kitchen', '/shop?category=kitchen'],
  ['Packs', '/shop?category=carry'],
];

const MARK = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><path d="M7 23 L13.5 11 L17 17 L19.5 13 L25 23 Z" fill="var(--accent-ink)"/></svg>`;

function header() {
  const here = location.pathname.replace(/\.html$/, '') + location.search;
  return `
    <div class="notice"><div class="wrap">
      <span>A demo shop for software testing. Nothing here is for sale. Pay with test card <code>4242 4242 4242 4242</code>.</span>
    </div></div>
    <header class="site-header">
      <div class="wrap">
        <button class="icon-btn menu-btn" type="button" aria-label="Menu" aria-expanded="false">${icon('menu')}</button>
        <a class="brand" href="/">${MARK}<span>Halden Outfitters</span></a>
        <nav class="main-nav" aria-label="Main">
          ${NAV.map(([label, href]) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <div class="header-actions">
          <a class="icon-btn" href="/shop#search" aria-label="Search">${icon('search')}</a>
          <a class="icon-btn" href="/account" data-account aria-label="Your account">${icon('user')}</a>
          <a class="icon-btn" href="/cart" aria-label="Cart">${icon('cart')}<span class="cart-count"></span></a>
        </div>
      </div>
    </header>`;
}

function footer() {
  return `
    <footer class="site-footer">
      <div class="wrap">
        <div class="about">
          <a class="brand" href="/">${MARK}<span>Halden Outfitters</span></a>
          <p class="muted small" style="margin-top:12px;max-width:34ch">A practice shop for testing web apps and their databases. Built with plain HTML, CSS and PostgreSQL.</p>
        </div>
        <div><h3>Shop</h3><ul>${NAV.map(([l, h]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div>
        <div><h3>Your account</h3><ul><li><a href="/account">Sign in</a></li><li><a href="/account#orders">Your orders</a></li><li><a href="/cart">Cart</a></li></ul></div>
        <div><h3>Help</h3><ul><li><a href="/help#shipping">Shipping</a></li><li><a href="/help#returns">Returns</a></li><li><a href="/help#testing">Testing this shop</a></li></ul></div>
        <p class="legal">Halden Outfitters is not a real store. Product photos are from Pexels and Unsplash; see the credits in the project README.</p>
      </div>
    </footer>`;
}

/** Puts the header and footer around the page, and fills in the cart count and account state. */
export async function initPage() {
  document.body.insertAdjacentHTML('afterbegin', header());
  document.body.insertAdjacentHTML('beforeend', footer());

  const head = document.querySelector('.site-header');
  const menu = head.querySelector('.menu-btn');
  menu.addEventListener('click', () => {
    const open = head.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  });

  const [customer, cart] = await Promise.all([currentCustomer(), api('GET', '/cart').catch(() => null)]);
  if (cart) setCartCount(cart.count);
  if (customer) {
    const account = document.querySelector('[data-account]');
    account.setAttribute('aria-label', `Your account (${customer.name})`);
    if (customer.isAdmin) account.insertAdjacentHTML('beforebegin', `<a class="btn btn-sm btn-secondary" href="/admin">${icon('gauge')} Admin</a>`);
  }
  reveal();
  return customer;
}

export function fieldErrors(form, err) {
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const el of form.querySelectorAll('.error')) el.remove();
  for (const [name, message] of Object.entries(err?.fields ?? {})) {
    const input = form.elements.namedItem(name);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    input.closest('.field')?.insertAdjacentHTML('beforeend', `<span class="error">${esc(message)}</span>`);
  }
}

export function busy(button, on, text) {
  if (on) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(text)}`;
  } else {
    button.disabled = false;
    button.innerHTML = button.dataset.label ?? button.innerHTML;
  }
}

/** The price summary of a cart: used on the cart and checkout pages. */
export function cartSummary(cart) {
  const t = cart.totals;
  return `
    <dl class="totals">
      <div><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd></div>
      ${Number(t.discount) > 0 ? `<div class="saving"><dt>Discount${cart.coupon ? ` (${esc(cart.coupon.code)})` : ''}</dt><dd>−${money(t.discount)}</dd></div>` : ''}
      <div><dt>Shipping</dt><dd>${Number(t.shipping) === 0 ? 'Free' : money(t.shipping)}</dd></div>
      <div><dt>Tax (8%)</dt><dd>${money(t.tax)}</dd></div>
      <div class="grand"><dt>Total</dt><dd>${money(t.total)}</dd></div>
    </dl>`;
}


const STATUS = { paid: ['Paid', 'badge-good'], shipped: ['Shipped', 'badge-good'], delivered: ['Delivered', ''], cancelled: ['Cancelled', 'badge-bad'] };
/** An order status as a badge. */
export const statusBadge = (s) => `<span class="badge ${STATUS[s]?.[1] ?? ''}">${STATUS[s]?.[0] ?? esc(s)}</span>`;
