import { api, busy, cartSummary, esc, fieldErrors, icon, initPage, money } from '../core.js';

const root = document.querySelector('[data-checkout]');
const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'Sweden', 'Norway', 'Japan', 'Australia', 'New Zealand', 'Sri Lanka'];

function form(customer, cart) {
  return `
    <div class="two-col">
      <form class="panel" data-form novalidate>
        <h2 style="font-size:1.25rem">Shipping address</h2>
        <div class="form-grid">
          <div class="field"><label for="name">Full name</label><input class="input" id="name" name="name" autocomplete="name" value="${esc(customer.name)}" required></div>
          <div class="field"><label for="line1">Address</label><input class="input" id="line1" name="line1" autocomplete="address-line1" required></div>
          <div class="form-grid two">
            <div class="field"><label for="city">City</label><input class="input" id="city" name="city" autocomplete="address-level2" required></div>
            <div class="field"><label for="postcode">Postcode</label><input class="input" id="postcode" name="postcode" autocomplete="postal-code" required></div>
          </div>
          <div class="field"><label for="country">Country</label>
            <select class="select" id="country" name="country" autocomplete="country-name">${COUNTRIES.map((c) => `<option>${c}</option>`).join('')}</select>
          </div>
        </div>
        <h2 style="font-size:1.25rem;margin-top:8px">Payment</h2>
        <div class="field">
          <label for="cardNumber">Card number</label>
          <input class="input num" id="cardNumber" name="cardNumber" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" maxlength="19" required>
          <span class="hint">Test cards only. 4242 4242 4242 4242 pays; 4000 0000 0000 0002 is declined.</span>
        </div>
        <div data-error></div>
        <button class="btn btn-block" type="submit" data-pay>${icon('lock')} Pay ${money(cart.totals.total)}</button>
      </form>
      <aside class="panel sticky" aria-label="Order summary">
        <h2 style="font-size:1.25rem">Your order</h2>
        <div class="lines">${cart.items.map((l) => `
          <div class="line" style="grid-template-columns:56px minmax(0,1fr) auto;padding:10px 0">
            <img src="${esc(l.image)}" alt="" style="width:56px;height:56px">
            <div><strong style="font-weight:560">${esc(l.name)}</strong><div class="muted small">Qty ${l.qty}</div></div>
            <span class="num">${money(l.lineTotal)}</span>
          </div>`).join('')}
        </div>
        ${cartSummary(cart)}
      </aside>
    </div>`;
}

async function start() {
  const customer = await initPage();
  if (!customer) {
    location.replace('/account?next=/checkout');
    return;
  }
  const cart = await api('GET', '/cart');
  if (cart.items.length === 0) {
    location.replace('/cart');
    return;
  }
  root.innerHTML = form(customer, cart);
  const f = root.querySelector('[data-form]');
  const card = f.elements.namedItem('cardNumber');
  card.addEventListener('input', () => {
    const digits = card.value.replace(/\D/g, '').slice(0, 16);
    card.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  });

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[data-pay]');
    const error = f.querySelector('[data-error]');
    error.innerHTML = '';
    fieldErrors(f, null);
    const data = Object.fromEntries(new FormData(f));
    busy(btn, true, 'Placing your order');
    try {
      const { orderId } = await api('POST', '/checkout', data);
      location.assign(`/order?id=${orderId}&placed=1`);
    } catch (err) {
      busy(btn, false);
      fieldErrors(f, err);
      error.innerHTML = `<div class="callout callout-bad">${icon('warning')} ${esc(err.message)}</div>`;
      (f.querySelector('[aria-invalid="true"]') ?? error).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

start().catch((err) => {
  root.innerHTML = `<p class="callout callout-bad">${icon('warning')} ${esc(err.message)}</p>`;
});
