import { api, esc, icon, initPage, productCard, productSkeletons, reveal, wireQuickAdd } from '../core.js';

initPage();

const grid = document.querySelector('[data-grid]');
const pills = document.querySelector('[data-pills]');
const search = document.querySelector('#search');
const sort = document.querySelector('[data-sort]');
const count = document.querySelector('[data-count]');
wireQuickAdd(grid);

const state = new URLSearchParams(location.search);
search.value = state.get('q') ?? '';
sort.value = state.get('sort') ?? 'featured';
if (location.hash === '#search') search.focus();

let categories = [];
let request = 0;

function renderPills() {
  const active = state.get('category') ?? '';
  pills.innerHTML = [{ slug: '', name: 'All' }, ...categories].map((c) => `
    <button class="pill" type="button" data-cat="${esc(c.slug)}" aria-pressed="${c.slug === active}">${esc(c.name)}</button>`).join('');
  const current = categories.find((c) => c.slug === active);
  document.querySelector('[data-title]').textContent = current ? current.name : 'Shop all gear';
  document.querySelector('[data-crumb]').textContent = current ? current.name : 'Shop';
  document.querySelector('[data-blurb]').textContent = current ? current.blurb : 'Everything we carry, tested on long trips.';
  document.title = `${current ? current.name : 'Shop all gear'} · Halden Outfitters`;
}

async function load() {
  const id = ++request;
  grid.innerHTML = productSkeletons(8);
  const q = new URLSearchParams();
  for (const key of ['category', 'q', 'sort']) if (state.get(key)) q.set(key, state.get(key));
  history.replaceState(null, '', `/shop${q.size ? `?${q}` : ''}`);
  try {
    const list = await api('GET', `/products?${q}`);
    if (id !== request) return; // a newer search has started
    count.textContent = `${list.length} ${list.length === 1 ? 'product' : 'products'}`;
    grid.innerHTML = list.length
      ? list.map(productCard).join('')
      : `<div class="empty" style="grid-column:1/-1">${icon('search')}<h3>Nothing matches “${esc(state.get('q') ?? '')}”</h3>
           <p class="muted">Try a shorter word, or look through every category.</p>
           <button class="btn btn-secondary" type="button" data-clear>Clear the search</button></div>`;
    reveal(grid);
  } catch (err) {
    grid.innerHTML = `<p class="callout callout-bad" style="grid-column:1/-1">${icon('warning')} ${esc(err.message)}</p>`;
  }
}

pills.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  if (btn.dataset.cat) state.set('category', btn.dataset.cat); else state.delete('category');
  renderPills();
  load();
});

let timer;
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (search.value.trim()) state.set('q', search.value.trim()); else state.delete('q');
    load();
  }, 250);
});

sort.addEventListener('change', () => {
  if (sort.value === 'featured') state.delete('sort'); else state.set('sort', sort.value);
  load();
});

grid.addEventListener('click', (e) => {
  if (!e.target.closest('[data-clear]')) return;
  search.value = '';
  state.delete('q');
  state.delete('category');
  renderPills();
  load();
});

api('GET', '/categories').then((list) => { categories = list; renderPills(); }).catch(() => {});
renderPills();
load();
