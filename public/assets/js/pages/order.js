import { api, busy, esc, formatDate, icon, initPage, money, params, statusBadge, toast } from '../core.js';

const root = document.querySelector('[data-order]');
const dialog = document.querySelector('[data-confirm]');
const id = params.get('id') ?? '';
const EVENT_ICON = { paid: 'receipt', shipped: 'truck', delivered: 'package', cancelled: 'close' };

/** The order page; the admin uses the same layout with its own API path and buttons. */
export function orderView(o, { placed = false, admin = false } = {}) {
  const t = o;
  return `
    ${placed ? `<div class="callout callout-good" style="margin-top:28px">${icon('check')} <span><strong>Thank you, your order is placed.</strong> This is a demo shop, so nothing will actually ship.</span></div>` : ''}
    <div class="page-head" style="display:flex;justify-content:space-between;align-items:end;flex-wrap:wrap;gap:16px">
      <div style="display:grid;gap:8px">
        <nav class="crumbs" aria-label="Breadcrumb">${admin ? '<a href="/admin#orders">Orders</a>' : '<a href="/account#orders">Your orders</a>'}<span aria-hidden="true">/</span><span>#${esc(o.id)}</span></nav>
        <h1 style="font-size:clamp(1.8rem,3vw,2.4rem)">Order #${esc(o.id)} ${statusBadge(o.status)}</h1>
        <p class="muted">Placed ${formatDate(o.createdAt, true)}${admin ? ` by ${esc(o.customerName)} (${esc(o.customerEmail)})` : ''}</p>
      </div>
      <div style="display:flex;gap:8px">
        ${admin && (o.status === 'paid' || o.status === 'shipped') ? `<button class="btn" type="button" data-advance>${icon(o.status === 'paid' ? 'truck' : 'package')} Mark as ${o.status === 'paid' ? 'shipped' : 'delivered'}</button>` : ''}
        ${o.canCancel ? `<button class="btn btn-danger" type="button" data-cancel>${icon('close')} Cancel order</button>` : ''}
      </div>
    </div>
    <div class="two-col">
      <div style="display:grid;gap:24px">
        <section class="panel" aria-label="Items">
          <div class="lines">${o.items.map((l) => `
            <div class="line" style="grid-template-columns:72px minmax(0,1fr) auto">
              <img src="${esc(l.image)}" alt="" style="width:72px;height:72px">
              <div class="line-main"><a href="/product?slug=${esc(l.slug)}">${esc(l.name)}</a><span class="muted small">${l.qty} × ${money(l.unitPrice)}</span></div>
              <div class="line-end">${money(l.lineTotal)}</div>
            </div>`).join('')}
          </div>
        </section>
        <section class="panel" aria-labelledby="history-title">
          <h2 id="history-title" style="font-size:1.1rem">Order history</h2>
          <ol class="timeline">${o.events.map((e) => `
            <li class="${esc(e.status)}"><span class="dot">${icon(EVENT_ICON[e.status] ?? 'check')}</span>
              <span><strong style="font-weight:560">${esc(e.note ?? e.status)}</strong><br><span class="muted small">${formatDate(e.at, true)}</span></span></li>`).join('')}
          </ol>
        </section>
      </div>
      <aside style="display:grid;gap:24px">
        <section class="panel" aria-label="Payment">
          <dl class="totals">
            <div><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd></div>
            ${Number(t.discount) > 0 ? `<div class="saving"><dt>Discount${t.couponCode ? ` (${esc(t.couponCode)})` : ''}</dt><dd>−${money(t.discount)}</dd></div>` : ''}
            <div><dt>Shipping</dt><dd>${Number(t.shipping) === 0 ? 'Free' : money(t.shipping)}</dd></div>
            <div><dt>Tax</dt><dd>${money(t.tax)}</dd></div>
            <div class="grand"><dt>Total</dt><dd>${money(t.total)}</dd></div>
          </dl>
          ${o.payment ? `<p class="muted small" style="display:flex;gap:8px;align-items:center">${icon('card')} ${o.payment.status === 'refunded' ? 'Refunded' : 'Charged'} ${money(o.payment.amount)} to the card ending ${esc(o.payment.cardLast4)}</p>` : ''}
        </section>
        <section class="panel" aria-labelledby="ship-title">
          <h2 id="ship-title" style="font-size:1.1rem">Shipping to</h2>
          <address style="font-style:normal;color:var(--ink-2)">${esc(o.shipName)}<br>${esc(o.shipLine1)}<br>${esc(o.shipCity)} ${esc(o.shipPostcode)}<br>${esc(o.shipCountry)}</address>
        </section>
      </aside>
    </div>`;
}

/**
 * Shows an order and wires its buttons. `base` is the API path for this order.
 * @param {HTMLElement} target
 * @param {string} base
 */
export async function mountOrder(target, base, { placed = false, admin = false } = {}) {
  const render = (o) => {
    target.innerHTML = orderView(o, { placed, admin });
    target.querySelector('[data-cancel]')?.addEventListener('click', () => dialog.showModal());
    target.querySelector('[data-advance]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget; // currentTarget is cleared once the handler awaits
      busy(btn, true, 'Updating');
      try { render(await api('POST', `${base}/advance`, {})); toast('Order updated.'); }
      catch (err) { toast(err.message, { bad: true }); busy(btn, false); }
    });
  };
  dialog.querySelector('[data-keep]').onclick = () => dialog.close();
  dialog.querySelector('[data-cancel-confirm]').onclick = async (e) => {
    const btn = e.currentTarget; // currentTarget is cleared once the handler awaits
    busy(btn, true, 'Cancelling');
    try {
      render(await api('POST', `${base}/cancel`, {}));
      toast('Order cancelled and refunded.');
    } catch (err) {
      toast(err.message, { bad: true });
    } finally {
      busy(btn, false);
      dialog.close();
    }
  };
  try {
    render(await api('GET', base));
  } catch (err) {
    target.innerHTML = `<div class="empty" style="margin-top:48px">${icon('receipt')}<h1 style="font-size:1.5rem">${err.status === 401 ? 'Sign in to see this order' : 'We couldn’t find that order'}</h1>
      <a class="btn" href="${err.status === 401 ? `/account?next=${encodeURIComponent('/account')}` : '/account'}">${err.status === 401 ? 'Sign in' : 'Your orders'}</a></div>`;
  }
}

if (root) {
  initPage();
  mountOrder(root, `/orders/${encodeURIComponent(id)}`, { placed: params.get('placed') === '1' });
}
