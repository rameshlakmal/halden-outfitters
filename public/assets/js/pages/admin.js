import { api, busy, esc, fieldErrors, formatDate, icon, initPage, money, statusBadge, toast } from '../core.js';
import { mountOrder } from './order.js';

const view = document.querySelector('[data-view]');
const bugCount = document.querySelector('[data-bug-count]');

function setBugCount(n) {
  bugCount.innerHTML = n > 0 ? `<span class="badge badge-bad">${n} on</span>` : '';
}

const fail = (err) => `<p class="callout callout-bad">${icon('warning')} ${esc(err.message)}</p>`;

// ---------- overview ----------

async function overview() {
  const s = await api('GET', '/admin/summary');
  setBugCount(s.bugsOn);
  view.innerHTML = `
    <div class="page-head" style="padding-top:0"><h1 style="font-size:2rem">Overview</h1></div>
    ${s.bugsOn ? `<div class="callout callout-bad" style="margin-bottom:20px">${icon('bug')} ${s.bugsOn} planted bug${s.bugsOn === 1 ? ' is' : 's are'} switched on. <a href="#qa">Open the QA lab</a></div>` : ''}
    <div class="stats">
      <div class="stat lead-stat"><span class="muted small">Revenue, all time</span><span class="value">${money(s.revenue)}</span><span class="muted small">${s.orders} orders, not counting cancelled</span></div>
      <div class="stat"><span class="muted small">To ship</span><span class="value">${s.toShip}</span></div>
      <div class="stat"><span class="muted small">Last 24 hours</span><span class="value">${s.lastDay}</span></div>
      <div class="stat"><span class="muted small">Low stock</span><span class="value">${s.lowStock.length}</span></div>
    </div>
    <div class="two-col" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);padding-top:28px">
      <section aria-labelledby="recent-title">
        <h2 id="recent-title" style="font-size:1.1rem;margin-bottom:12px">Recent orders</h2>
        <div class="table-wrap"><table class="data"><tbody>${s.recent.map((o) => `
          <tr class="clickable" data-href="#orders/${esc(o.id)}"><td><strong>#${esc(o.id)}</strong><br><span class="muted small">${esc(o.customerName)}</span></td>
          <td>${statusBadge(o.status)}</td><td class="right num">${money(o.total)}</td></tr>`).join('')}</tbody></table></div>
      </section>
      <section aria-labelledby="low-title">
        <h2 id="low-title" style="font-size:1.1rem;margin-bottom:12px">Running low</h2>
        ${s.lowStock.length ? `<div class="table-wrap"><table class="data"><tbody>${s.lowStock.map((p) => `
          <tr class="clickable" data-href="#products"><td><span class="prod-cell"><img src="${esc(p.image)}" alt="">${esc(p.name)}</span></td>
          <td class="right">${p.stock === 0 ? '<span class="badge badge-bad">Sold out</span>' : `<span class="badge badge-warn">${p.stock} left</span>`}</td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty">${icon('check')}<p class="muted">Everything is well stocked.</p></div>`}
      </section>
    </div>`;
}

// ---------- orders ----------

async function orders(filter = '') {
  const list = await api('GET', `/admin/orders${filter ? `?status=${filter}` : ''}`);
  view.innerHTML = `
    <div class="page-head" style="padding-top:0"><h1 style="font-size:2rem">Orders</h1></div>
    <div class="toolbar" style="margin-top:0"><div class="pills" role="group" aria-label="Status">
      ${[['', 'All'], ['paid', 'To ship'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']].map(([v, l]) =>
        `<button class="pill" type="button" data-status="${v}" aria-pressed="${v === filter}">${l}</button>`).join('')}
    </div></div>
    ${list.length ? `<div class="table-wrap"><table class="data">
      <thead><tr><th>Order</th><th>Customer</th><th>Placed</th><th>Items</th><th>Status</th><th class="right">Total</th></tr></thead>
      <tbody>${list.map((o) => `
        <tr class="clickable" data-href="#orders/${esc(o.id)}"><td><strong>#${esc(o.id)}</strong></td>
        <td>${esc(o.customerName)}<br><span class="muted small">${esc(o.customerEmail)}</span></td>
        <td class="muted">${formatDate(o.createdAt)}</td><td>${o.itemCount}</td><td>${statusBadge(o.status)}</td><td class="right num">${money(o.total)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${icon('receipt')}<p class="muted">No orders here.</p></div>`}`;
  view.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => show(orders(b.dataset.status))));
}

// ---------- products ----------

async function products() {
  const list = await api('GET', '/admin/products');
  view.innerHTML = `
    <div class="page-head" style="padding-top:0"><h1 style="font-size:2rem">Products</h1>
      <p class="muted">Change a price and press Enter. Stock changes are logged as restocks or adjustments.</p></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Sold</th><th>On sale</th></tr></thead>
      <tbody>${list.map((p) => `
        <tr data-id="${esc(p.id)}">
          <td><span class="prod-cell"><img src="${esc(p.image)}" alt=""><span>${esc(p.name)}<br><span class="muted small">${esc(p.categoryName)}</span></span></span></td>
          <td><form class="inline-form" data-price novalidate><span class="field"><label class="sr-only" for="price-${esc(p.id)}">Price of ${esc(p.name)}</label>
            <input class="input num" id="price-${esc(p.id)}" name="price" value="${esc(p.price)}" inputmode="decimal"></span></form></td>
          <td><form class="inline-form" data-stock novalidate>
            <span class="num" style="min-width:2.5ch;display:inline-block">${p.stock}</span>
            <span class="field"><label class="sr-only" for="stock-${esc(p.id)}">Add or remove stock for ${esc(p.name)}</label>
            <input class="input num" id="stock-${esc(p.id)}" name="change" placeholder="+10" inputmode="numeric" style="width:72px"></span>
            <button class="btn btn-secondary btn-sm" type="submit">Update</button></form></td>
          <td class="num">${p.sold}</td>
          <td><label class="switch"><input type="checkbox" data-active ${p.active ? 'checked' : ''} aria-label="${esc(p.name)} is on sale"><span></span></label></td>
        </tr>`).join('')}
      </tbody></table></div>`;

  view.querySelectorAll('[data-price]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = f.closest('tr').dataset.id;
    try {
      await api('PATCH', `/admin/products/${id}`, { price: f.elements.namedItem('price').value });
      fieldErrors(f, null);
      toast('Price saved.');
    } catch (err) { fieldErrors(f, err); toast(err.message, { bad: true }); }
  }));
  view.querySelectorAll('[data-stock]').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = f.closest('tr').dataset.id;
    try {
      const { stock } = await api('POST', `/admin/products/${id}/stock`, { change: f.elements.namedItem('change').value });
      f.querySelector('.num').textContent = String(stock);
      f.reset();
      fieldErrors(f, null);
      toast(`Stock is now ${stock}.`);
    } catch (err) { fieldErrors(f, err); toast(err.message, { bad: true }); }
  }));
  view.querySelectorAll('[data-active]').forEach((box) => box.addEventListener('change', async () => {
    const id = box.closest('tr').dataset.id;
    try { await api('PATCH', `/admin/products/${id}`, { active: box.checked }); toast(box.checked ? 'Back on sale.' : 'Taken off sale.'); }
    catch (err) { box.checked = !box.checked; toast(err.message, { bad: true }); }
  }));
}

// ---------- coupons ----------

async function coupons() {
  const list = await api('GET', '/admin/coupons');
  const describe = (c) => `${c.kind === 'percent' ? `${Number(c.value)}% off` : `${money(c.value)} off`}${Number(c.minSubtotal) > 0 ? ` orders over ${money(c.minSubtotal)}` : ''}`;
  view.innerHTML = `
    <div class="page-head" style="padding-top:0"><h1 style="font-size:2rem">Coupons</h1></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Code</th><th>Gives</th><th>Used</th><th>Expires</th><th>Active</th></tr></thead>
      <tbody>${list.map((c) => {
        const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
        return `<tr data-code="${esc(c.code)}"><td><strong class="num">${esc(c.code)}</strong></td><td>${describe(c)}</td>
          <td class="num">${c.usedCount}${c.maxUses ? ` of ${c.maxUses}` : ''}</td>
          <td>${c.expiresAt ? `${expired ? '<span class="badge badge-bad">Expired</span> ' : ''}<span class="muted small">${formatDate(c.expiresAt)}</span>` : '<span class="muted">Never</span>'}</td>
          <td><label class="switch"><input type="checkbox" data-coupon-active ${c.active ? 'checked' : ''} aria-label="${esc(c.code)} is active"><span></span></label></td></tr>`;
      }).join('')}</tbody></table></div>
    <form class="panel" data-new-coupon novalidate style="margin-top:24px">
      <h2 style="font-size:1.1rem">New coupon</h2>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <div class="field"><label for="c-code">Code</label><input class="input" id="c-code" name="code" placeholder="FALL15" maxlength="20" style="text-transform:uppercase"></div>
        <div class="field"><label for="c-kind">Type</label><select class="select" id="c-kind" name="kind"><option value="percent">Percent off</option><option value="fixed">Amount off</option></select></div>
        <div class="field"><label for="c-value">Value</label><input class="input num" id="c-value" name="value" placeholder="15" inputmode="decimal"></div>
        <div class="field"><label for="c-min">Minimum order</label><input class="input num" id="c-min" name="minSubtotal" placeholder="0" inputmode="decimal"></div>
        <div class="field"><label for="c-max">Use limit</label><input class="input num" id="c-max" name="maxUses" placeholder="No limit" inputmode="numeric"></div>
      </div>
      <div><button class="btn" type="submit">${icon('plus')} Create coupon</button></div>
    </form>`;

  view.querySelectorAll('[data-coupon-active]').forEach((box) => box.addEventListener('change', async () => {
    const code = box.closest('tr').dataset.code;
    try { await api('PATCH', `/admin/coupons/${code}`, { active: box.checked }); toast(`${code} ${box.checked ? 'switched on' : 'switched off'}.`); }
    catch (err) { box.checked = !box.checked; toast(err.message, { bad: true }); }
  }));
  const form = view.querySelector('[data-new-coupon]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true, 'Creating');
    try {
      await api('POST', '/admin/coupons', Object.fromEntries(new FormData(form)));
      toast('Coupon created.');
      await coupons();
    } catch (err) {
      busy(btn, false);
      fieldErrors(form, err);
    }
  });
}

// ---------- QA lab ----------

async function qaLab() {
  const bugs = await api('GET', '/admin/bugs');
  setBugCount(bugs.filter((b) => b.enabled).length);
  view.innerHTML = `
    <div class="page-head" style="padding-top:0"><h1 style="font-size:2rem">QA lab</h1>
      <p class="lead">Switch on a planted bug, use the shop as a customer would, and see if your tests catch it. Each bug leaves a trace in the database.</p></div>
    <div class="bug-list">${bugs.map((b) => `
      <div class="bug ${b.enabled ? 'on' : ''}" data-key="${esc(b.key)}">
        <div style="display:grid;gap:6px"><h2 style="font-size:1.05rem">${esc(b.title)}</h2><p>${esc(b.description)}</p></div>
        <label class="switch"><input type="checkbox" ${b.enabled ? 'checked' : ''} aria-label="${esc(b.title)}"><span></span></label>
        <p class="how">${icon('info')} ${esc(b.howToSee)}</p>
      </div>`).join('')}
    </div>`;
  view.querySelectorAll('.bug input').forEach((box) => box.addEventListener('change', async () => {
    const card = box.closest('.bug');
    try {
      await api('PATCH', `/admin/bugs/${card.dataset.key}`, { enabled: box.checked });
      card.classList.toggle('on', box.checked);
      setBugCount(view.querySelectorAll('.bug input:checked').length);
      toast(box.checked ? 'Bug switched on.' : 'Bug switched off.');
    } catch (err) { box.checked = !box.checked; toast(err.message, { bad: true }); }
  }));
}

// ---------- routing ----------

async function show(promise) {
  try { await promise; } catch (err) { view.innerHTML = fail(err); }
}

function route() {
  const [tab, id] = location.hash.replace(/^#/, '').split('/');
  const current = tab || 'overview';
  document.querySelectorAll('[data-tab]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === current));
  document.querySelector(`[data-tab="${current}"]`)?.setAttribute('aria-current', 'page');
  view.innerHTML = '<div class="skeleton line" style="height:120px;border-radius:16px"></div>';
  if (current === 'orders' && id) return show(mountOrder(view, `/admin/orders/${encodeURIComponent(id)}`, { admin: true }));
  return show({ overview, orders, products, coupons, qa: qaLab }[current]?.() ?? overview());
}

view.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a, button, input, label')) location.hash = row.dataset.href;
});

initPage().then((customer) => {
  if (!customer) { location.replace('/account?next=/admin'); return; }
  if (!customer.isAdmin) {
    document.querySelector('.admin').innerHTML = `<div class="empty" style="grid-column:1/-1;margin-top:24px">${icon('lock')}<h1 style="font-size:1.5rem">Staff only</h1><p class="muted">Sign in with a shop staff account to use the admin.</p><a class="btn" href="/">Back to the shop</a></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
});
