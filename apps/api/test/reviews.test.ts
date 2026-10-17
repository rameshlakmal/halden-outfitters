import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authorName, holdReason } from '../src/modules/reviews/service.js';
import { json, lastEmail, startApp, type TestApp } from './helpers.js';
import { bug, checkout, deliveredOrder, fill, newCustomer, signedIn } from './shop.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(() => t.reseed());
afterAll(() => t.close());

const review = (rating = 5, extra: Record<string, unknown> = {}) => ({
  rating,
  title: 'Does the job well',
  body: 'Used it on a week in the hills and it worked every single time.',
  ...extra,
});

async function rating(slug: string) {
  return t.db.one<{ rating_avg: string | null; rating_count: number }>(
    'SELECT rating_avg, rating_count FROM products WHERE slug = $1',
    [slug],
  );
}

describe('moderation rules', () => {
  it('holds links, email addresses and blocked words', () => {
    expect(holdReason('Great, see https://example.com')).toBe('Contains a link');
    expect(holdReason('bought one at example.shop')).toBe('Contains a link');
    expect(holdReason('mail me at a@b.co')).toBe('Contains an email address');
    expect(holdReason('total scam')).toMatch(/blocked word/);
    expect(holdReason('Scampi tastes great cooked on it')).toBeNull();
  });

  it('shows first name and last initial', () => {
    expect(authorName('Maya Okafor')).toBe('Maya O.');
    expect(authorName('Cher')).toBe('Cher');
  });
});

describe('writing reviews', () => {
  it('a verified buyer reviews: published, and the product rating updates', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const res = await d.client.post('/products/titanium-pot/reviews', review(4));
    expect(res.statusCode).toBe(201);
    expect(json(res)).toMatchObject({
      status: 'published',
      rating: 4,
      author: 'Robin F.',
      mine: true,
      verifiedBuyer: true,
    });
    expect(await rating('titanium-pot')).toEqual({ rating_avg: '4.0', rating_count: 1 });
    const page = json(await d.client.get('/products/titanium-pot/reviews'));
    expect(page.summary).toMatchObject({ average: 4, count: 1, distribution: { 4: 1 } });
    expect(page.viewer).toMatchObject({ canReview: false, reason: 'You have already reviewed this product.' });
    expect(json(await t.app.inject({ url: '/api/v1/products/titanium-pot' })).rating).toEqual({ average: 4, count: 1 });
  });

  it('refuses customers who have not received the product', async () => {
    const c = await newCustomer(t);
    expect(json(await c.client.get('/products/titanium-pot/reviews')).viewer).toMatchObject({ canReview: false });
    const res = await c.client.post('/products/titanium-pot/reviews', review());
    expect(res.statusCode).toBe(403);
    expect(json(res).code).toBe('review_not_allowed');
    // Ordered but not delivered yet: still no.
    await fill(t, c.client, [['titanium-pot', 1]]);
    await checkout(c.client, c.addressId);
    expect((await c.client.post('/products/titanium-pot/reviews', review())).statusCode).toBe(403);
  });

  it('refuses a customer who returned and was refunded for every unit', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const productId = json(await d.client.get(`/orders/${d.orderId}`)).lines[0].productId;
    const r = json(
      await d.client.post(`/orders/${d.orderId}/returns`, { items: [{ productId, qty: 1 }], reason: 'damaged' }),
    );
    await d.warehouse.post(`/staff/returns/${r.id}/receive`, { items: [{ productId, condition: 'as_new' }] });
    const res = await d.client.post('/products/titanium-pot/reviews', review());
    expect(res.statusCode).toBe(403);
    expect(json(res).detail).toMatch(/returned/);
  });

  it('one review per product', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    await d.client.post('/products/titanium-pot/reviews', review());
    const res = await d.client.post('/products/titanium-pot/reviews', review());
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe('already_reviewed');
  });

  it('validates stars, title and body, and fit only for sized products', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const bad = await d.client.post('/products/titanium-pot/reviews', { rating: 6, title: 'Hi', body: 'Short' });
    expect(bad.statusCode).toBe(400);
    expect(
      json(bad)
        .errors.map((e: { path: string }) => e.path)
        .sort(),
    ).toEqual(['body', 'rating', 'title']);
    const fit = await d.client.post('/products/titanium-pot/reviews', review(5, { fit: 'true_to_size' }));
    expect(json(fit).errors[0].path).toBe('fit');
  });

  it('a review with a link waits for support; publishing it counts it', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const r = json(
      await d.client.post(
        '/products/titanium-pot/reviews',
        review(2, { body: 'It dented on day one, details on www.example.com' }),
      ),
    );
    expect(r).toMatchObject({ status: 'pending', heldFor: 'Contains a link' });
    expect(await rating('titanium-pot')).toEqual({ rating_avg: null, rating_count: 0 });
    expect(json(await d.client.get('/products/titanium-pot/reviews')).items).toEqual([]);
    const support = await signedIn(t, 'support@halden.test', true);
    expect(json(await support.get('/staff/reviews?status=pending')).items.map((x: { id: string }) => x.id)).toContain(
      r.id,
    );
    expect(json(await support.post(`/staff/reviews/${r.id}/publish`)).status).toBe('published');
    expect(await rating('titanium-pot')).toEqual({ rating_avg: '2.0', rating_count: 1 });
  });

  it('editing works for 30 days and re-checks moderation; deleting updates the rating', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const r = json(await d.client.post('/products/titanium-pot/reviews', review(5)));
    const edited = json(await d.client.put(`/reviews/${r.id}`, review(3)));
    expect(edited).toMatchObject({ rating: 3, status: 'published' });
    expect(edited.editedAt).toBeTruthy();
    expect(await rating('titanium-pot')).toMatchObject({ rating_avg: '3.0' });
    const held = json(
      await d.client.put(`/reviews/${r.id}`, review(3, { body: 'Write to me at robin@example.com for photos.' })),
    );
    expect(held.status).toBe('pending');
    for (let i = 0; i < 3; i++) {
      await t.advance(10 * 86400 + 3600);
      await d.client.get('/auth/session');
    }
    expect((await d.client.put(`/reviews/${r.id}`, review(4))).statusCode).toBe(409);
    expect((await d.client.delete(`/reviews/${r.id}`)).statusCode).toBe(204);
    expect(await rating('titanium-pot')).toEqual({ rating_avg: null, rating_count: 0 });
  });

  it('other customers cannot edit or delete a review', async () => {
    const d = await deliveredOrder(t, [['titanium-pot', 1]]);
    const r = json(await d.client.post('/products/titanium-pot/reviews', review()));
    const other = await newCustomer(t);
    expect((await other.client.put(`/reviews/${r.id}`, review(1))).statusCode).toBe(404);
    expect((await other.client.delete(`/reviews/${r.id}`)).statusCode).toBe(404);
  });
});

describe('ratings and votes', () => {
  it('averages published reviews to one decimal; hiding one takes it out and emails the author', async () => {
    const a = await deliveredOrder(t, [['titanium-pot', 1]]);
    const b = await deliveredOrder(t, [['titanium-pot', 1]]);
    const c = await deliveredOrder(t, [['titanium-pot', 1]]);
    await a.client.post('/products/titanium-pot/reviews', review(5));
    await b.client.post('/products/titanium-pot/reviews', review(4));
    const low = json(await c.client.post('/products/titanium-pot/reviews', review(1)));
    expect(await rating('titanium-pot')).toEqual({ rating_avg: '3.3', rating_count: 3 });
    const support = await signedIn(t, 'support@halden.test', true);
    expect((await a.client.post(`/staff/reviews/${low.id}/hide`, { reason: 'Off topic' })).statusCode).toBe(403);
    const hidden = json(await support.post(`/staff/reviews/${low.id}/hide`, { reason: 'Off topic' }));
    expect(hidden).toMatchObject({ status: 'hidden', hiddenReason: 'Off topic' });
    expect(await rating('titanium-pot')).toEqual({ rating_avg: '4.5', rating_count: 2 });
    expect((await lastEmail(t.db, c.email))?.template).toBe('review_hidden');
    expect(json(await c.client.get('/account/reviews')).items[0]).toMatchObject({
      status: 'hidden',
      hiddenReason: 'Off topic',
    });
    expect((await c.client.put(`/reviews/${low.id}`, review(2))).statusCode).toBe(409);
  });

  it('helpful votes: once per customer, not on your own, and they sort the list', async () => {
    const a = await deliveredOrder(t, [['titanium-pot', 1]]);
    const b = await deliveredOrder(t, [['titanium-pot', 1]]);
    const ra = json(await a.client.post('/products/titanium-pot/reviews', review(5)));
    const rb = json(await b.client.post('/products/titanium-pot/reviews', review(3)));
    expect((await a.client.put(`/reviews/${ra.id}/helpful`, {})).statusCode).toBe(403);
    expect((await a.client.put(`/reviews/${rb.id}/helpful`, {})).statusCode).toBe(204);
    expect((await a.client.put(`/reviews/${rb.id}/helpful`, {})).statusCode).toBe(409);
    const helpful = json(await a.client.get('/products/titanium-pot/reviews'));
    expect(helpful.items.map((r: { id: string }) => r.id)).toEqual([rb.id, ra.id]);
    expect(helpful.items[0]).toMatchObject({ helpfulCount: 1, votedHelpful: true });
    expect(json(await a.client.get('/products/titanium-pot/reviews?sort=highest')).items[0].id).toBe(ra.id);
    expect(
      json(await a.client.get('/products/titanium-pot/reviews?rating=3')).items.map((r: { id: string }) => r.id),
    ).toEqual([rb.id]);
    expect((await a.client.delete(`/reviews/${rb.id}/helpful`)).statusCode).toBe(204);
    const after = json(await a.client.get('/products/titanium-pot/reviews')).items.find(
      (r: { id: string }) => r.id === rb.id,
    );
    expect(after.helpfulCount).toBe(0);
    const anon = await newCustomer(t);
    await anon.client.post('/auth/logout');
    expect((await anon.client.put(`/reviews/${rb.id}/helpful`, {})).statusCode).toBe(401);
  });

  it('planted bug hidden_reviews_counted: hiding a review leaves the rating as it was', async () => {
    await bug(t, 'hidden_reviews_counted');
    const a = await deliveredOrder(t, [['titanium-pot', 1]]);
    const b = await deliveredOrder(t, [['titanium-pot', 1]]);
    await a.client.post('/products/titanium-pot/reviews', review(5));
    const low = json(await b.client.post('/products/titanium-pot/reviews', review(1)));
    const support = await signedIn(t, 'support@halden.test', true);
    await support.post(`/staff/reviews/${low.id}/hide`, { reason: 'Off topic' });
    expect(await rating('titanium-pot')).toEqual({ rating_avg: '3.0', rating_count: 2 });
  });
});

describe('seeded reviews', () => {
  it('match the demo orders and hold one for moderation', async () => {
    await t.reseed({ orders: true });
    const rows = await t.db.query<{ slug: string; status: string }>(
      'SELECT p.slug, r.status FROM reviews r JOIN products p ON p.id = r.product_id ORDER BY r.id',
    );
    expect(rows.filter((r) => r.status === 'pending').map((r) => r.slug)).toEqual(['camp-pillow']);
    expect(await rating('camp-pillow')).toEqual({ rating_avg: '3.0', rating_count: 1 });
  });
});
