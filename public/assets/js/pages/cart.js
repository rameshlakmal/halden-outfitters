import { api, cartSummary, esc, fieldErrors, icon, initPage, money, setCartCount, toast } from '../core.js';

initPage();
const root = document.querySelector('[data-cart]');

function render(cart) {
  setCartCount(cart.count);
  if (cart.items.length === 0) {
    root.innerHTML = `
      <div class="empty" style="margin-top:24px">${icon('cart')}<h2 style="font-size:1.4rem">Your cart is empty</h2>
        <p class="muted">Find a tent, a warm bag and a stove for your next trip.</p>
        <a class="btn" href="/shop">Start shopping</a></div>`;
    return;
  }
  const blocked = cart.items.some((l) => l.problem);
  const t = cart.totals;
  root.innerHTML = `
    <div class="two-col">
      <section aria-label="Items">
        <div class="lines">${cart.items.map((l) => `
          <div class="line" data-line="${esc(l.productId)}">
            <img src="${esc(l.image)}" alt="" width="96" height="96">
            <div class="line-main">
              <a href="/product?slug=${esc(l.slug)}">${esc(l.name)}</a>
              <span class="muted small">${money(l.unitPrice)} each</span>
              ${l.problem ? `<span class="problem">${esc(l.problem)}</span>` : ''}
              <div class="stepper" role="group" aria-label="Quantity of ${esc(l.name)}">
                <button type="button" data-qty="${l.qty - 1}" aria-label="One fewer" ${l.qty <= 1 ? 'disabled' : ''}>${icon('minus')}</button>
                <output>${l.qty}</output>
                <button type="button" data-qty="${l.qty + 1}" aria-label="One more" ${l.qty >= Math.min(l.stock, 20) ? 'disabled' : ''}>${icon('plus')}</button>
              </div>
            </div>
            <div class="line-end">
              <span>${money(l.lineTotal)}</span>
              <button class="btn btn-ghost btn-sm" type="button" data-remove aria-label="Remove ${esc(l.name)}">${icon('trash')} Remove</button>
            </div>
          </div>`).join('')}
        </div>
      </section>
      <aside class="panel sticky" aria-label="Order summary">
        <h2 style="font-size:1.25rem">Order summary</h2>
        ${t.toFreeShipping ? `<div class="callout">${icon('truck')} Add ${money(t.toFreeShipping)} more for free shipping.</div>` : `<div class="callout callout-good">${icon('truck')} Your order ships free.</div>`}
        ${cart.coupon ? `
          <div class="callout ${cart.coupon.applied ? 'callout-good' : 'callout-bad'}" style="justify-content:space-between;align-items:center">
            <span>${icon('tag')} <strong>${esc(cart.coupon.code)}</strong> ${cart.coupon.applied ? 'applied' : esc(cart.coupon.note ?? '')}</span>
            <button class="btn btn-ghost btn-sm" type="button" data-remove-coupon>Remove</button>
          </div>` : `
          <form class="coupon-form" data-coupon novalidate>
            <div class="field" style="flex:1">
              <label for="code" class="sr-only">Discount code</label>
              <input class="input" id="code" name="code" placeholder="Discount code" autocomplete="off" maxlength="20">
            </div>
            <button class="btn btn-secondary" type="submit">Apply</button>
          </form>`}
        ${cartSummary(cart)}
        ${blocked ? `<div class="callout callout-bad">${icon('warning')} Fix the items marked above to check out.</div>` : ''}
        <a class="btn btn-block" href="/checkout" ${blocked ? 'aria-disabled="true" tabindex="-1" onclick="return false"' : ''}>${icon('lock')} Check out</a>
        <p class="muted small" style="text-align:center">Try the code WELCOME10 for 10% off.</p>
      </aside>
    </div>`;
}

async function act(promise) {
  try {
    render(await promise);
  } catch (err) {
    const form = root.querySelector('[data-coupon]');
    if (form && err.fields?.code) fieldErrors(form, err); else toast(err.message, { bad: true });
  }
}

root.addEventListener('click', (e) => {
  const line = e.target.closest('[data-line]');
  const qtyBtn = e.target.closest('[data-qty]');
  if (line && qtyBtn) act(api('PATCH', `/cart/items/${line.dataset.line}`, { qty: Number(qtyBtn.dataset.qty) }));
  else if (line && e.target.closest('[data-remove]')) act(api('DELETE', `/cart/items/${line.dataset.line}`));
  else if (e.target.closest('[data-remove-coupon]')) act(api('DELETE', '/cart/coupon'));
});

root.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-coupon]');
  if (!form) return;
  e.preventDefault();
  const code = form.elements.namedItem('code').value.trim();
  if (!code) { fieldErrors(form, { fields: { code: 'Enter a code.' } }); return; }
  act(api('POST', '/cart/coupon', { code }));
});

api('GET', '/cart').then(render).catch((err) => {
  root.innerHTML = `<p class="callout callout-bad">${icon('warning')} ${esc(err.message)}</p>`;
});
