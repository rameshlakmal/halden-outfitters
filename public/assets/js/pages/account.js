import { api, busy, esc, fieldErrors, formatDate, icon, initPage, money, params, statusBadge } from '../core.js';

const root = document.querySelector('[data-account-page]');
// Only go back to a page on this site after signing in.
const next = /^\/[a-z/]*$/.test(params.get('next') ?? '') ? params.get('next') : null;


function authForms(mode) {
  return `
    <div class="auth-card">
      <div class="page-head" style="padding-top:0"><h1 style="font-size:2rem">${mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p class="muted">${next === '/checkout' ? 'Sign in to finish your order. Your cart comes with you.' : 'Track orders and check out faster.'}</p></div>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${mode === 'login'}" data-mode="login">Sign in</button>
        <button type="button" role="tab" aria-selected="${mode === 'register'}" data-mode="register">Create account</button>
      </div>
      <form class="form-grid" data-auth="${mode}" novalidate>
        ${mode === 'register' ? '<div class="field"><label for="name">Name</label><input class="input" id="name" name="name" autocomplete="name" required></div>' : ''}
        <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Password</label>
          <input class="input" id="password" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
          ${mode === 'register' ? '<span class="hint">At least 8 characters.</span>' : ''}
        </div>
        <div data-error></div>
        <button class="btn btn-block" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
    </div>`;
}

function showAuth(mode) {
  root.innerHTML = authForms(mode);
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => showAuth(b.dataset.mode)));
  const form = root.querySelector('[data-auth]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const error = form.querySelector('[data-error]');
    error.innerHTML = '';
    fieldErrors(form, null);
    busy(btn, true, mode === 'login' ? 'Signing in' : 'Creating your account');
    try {
      await api('POST', mode === 'login' ? '/auth/login' : '/auth/register', Object.fromEntries(new FormData(form)));
      location.assign(next ?? '/account');
    } catch (err) {
      busy(btn, false);
      fieldErrors(form, err);
      if (!Object.keys(err.fields).length || err.status !== 400) error.innerHTML = `<div class="callout callout-bad">${icon('warning')} ${esc(err.message)}</div>`;
    }
  });
  form.querySelector('input').focus();
}

async function showAccount(customer) {
  root.innerHTML = `
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:end;flex-wrap:wrap;gap:16px">
      <div style="display:grid;gap:8px"><h1>Hello, ${esc(customer.name.split(' ')[0])}</h1><p class="muted">${esc(customer.email)}</p></div>
      <button class="btn btn-secondary" type="button" data-logout>${icon('signout')} Sign out</button>
    </div>
    <section id="orders" style="margin-top:24px" aria-labelledby="orders-title">
      <h2 id="orders-title" style="font-size:1.4rem;margin-bottom:16px">Your orders</h2>
      <div class="order-list" data-orders><div class="skeleton line" style="height:82px;border-radius:16px"></div></div>
    </section>`;
  root.querySelector('[data-logout]').addEventListener('click', async () => {
    await api('POST', '/auth/logout', {});
    location.assign('/');
  });
  const list = root.querySelector('[data-orders]');
  try {
    const orders = await api('GET', '/orders');
    list.innerHTML = orders.length ? orders.map((o) => `
      <a class="order-row" href="/order?id=${esc(o.id)}">
        <span class="thumbs">${o.images.map((src) => `<img src="${esc(src)}" alt="">`).join('')}</span>
        <span style="display:grid;gap:2px"><strong>Order #${esc(o.id)}</strong><span class="muted small">${formatDate(o.createdAt)} · ${o.itemCount} item${o.itemCount === 1 ? '' : 's'}</span></span>
        <span style="display:grid;justify-items:end;gap:6px"><span class="num" style="font-weight:600">${money(o.total)}</span>${statusBadge(o.status)}</span>
      </a>`).join('')
      : `<div class="empty">${icon('receipt')}<h3>No orders yet</h3><p class="muted">When you place an order, it shows up here.</p><a class="btn" href="/shop">Start shopping</a></div>`;
  } catch (err) {
    list.innerHTML = `<p class="callout callout-bad">${icon('warning')} ${esc(err.message)}</p>`;
  }
}

initPage().then((customer) => {
  if (customer) showAccount(customer);
  else showAuth(params.get('mode') === 'register' ? 'register' : 'login');
});
