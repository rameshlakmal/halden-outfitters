import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, json, PASSWORDS, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let maya: Client;
beforeAll(async () => {
  t = await startApp();
});
beforeEach(async () => {
  await t.reseed();
  maya = new Client(t.app);
  await maya.login('maya@halden.test', PASSWORDS.shopper);
});
afterAll(() => t.close());

const address = (over: Record<string, unknown> = {}) => ({
  name: 'Maya Okafor',
  line1: '9 Fir Road',
  city: 'Eugene',
  postcode: '97401',
  countryCode: 'us',
  ...over,
});

describe('needs a session', () => {
  it.each([
    ['GET', '/account/addresses'],
    ['GET', '/account/sessions'],
    ['PATCH', '/account/profile'],
    ['POST', '/account/password'],
  ] as const)('%s %s', async (method, url) => {
    const res = await new Client(t.app).req(method, url, method === 'GET' ? undefined : { name: 'x', currentPassword: 'x', newPassword: 'xxxxxxxxxxxx' });
    expect(res.statusCode).toBe(401);
    expect(json(res).code).toBe('unauthenticated');
  });
});

describe('profile and password', () => {
  it('changes the name', async () => {
    expect(json(await maya.patch('/account/profile', { name: '  Maya O.  ' })).name).toBe('Maya O.');
    expect(json(await maya.get('/auth/session')).customer.name).toBe('Maya O.');
  });

  it('a password change needs the current password and signs out the other devices only', async () => {
    const laptop = new Client(t.app);
    await laptop.login('maya@halden.test', PASSWORDS.shopper);

    const wrong = await maya.post('/account/password', { currentPassword: 'not my password', newPassword: 'a brand new password' });
    expect(json(wrong).errors[0].path).toBe('currentPassword');

    const same = await maya.post('/account/password', { currentPassword: PASSWORDS.shopper, newPassword: PASSWORDS.shopper });
    expect(json(same).errors[0].path).toBe('newPassword');

    expect((await maya.post('/account/password', { currentPassword: PASSWORDS.shopper, newPassword: 'a brand new password' })).statusCode).toBe(200);
    expect(json(await maya.get('/auth/session')).customer).not.toBeNull();
    expect(json(await laptop.get('/auth/session')).customer).toBeNull();
  });
});

describe('devices', () => {
  it('lists active sessions and marks this one', async () => {
    const laptop = new Client(t.app);
    await laptop.login('maya@halden.test', PASSWORDS.shopper);
    const list = json(await maya.get('/account/sessions')).items;
    expect(list).toHaveLength(2);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('signs out one device, or all the others', async () => {
    const laptop = new Client(t.app);
    const tablet = new Client(t.app);
    await laptop.login('maya@halden.test', PASSWORDS.shopper);
    await tablet.login('maya@halden.test', PASSWORDS.shopper);
    const laptopId = json(await laptop.get('/account/sessions')).items.find((s: { current: boolean }) => s.current).id;

    expect((await maya.delete(`/account/sessions/${laptopId}`)).statusCode).toBe(200);
    expect(json(await laptop.get('/auth/session')).customer).toBeNull();
    expect(json(await maya.post('/account/sessions/revoke-others')).revoked).toBe(1);
    expect(json(await tablet.get('/auth/session')).customer).toBeNull();
    expect(json(await maya.get('/auth/session')).customer).not.toBeNull();
  });

  it("cannot touch another customer's session", async () => {
    const jonas = new Client(t.app);
    await jonas.login('jonas@halden.test', PASSWORDS.shopper);
    const jonasId = json(await jonas.get('/account/sessions')).items[0].id;
    expect((await maya.delete(`/account/sessions/${jonasId}`)).statusCode).toBe(404);
    expect(json(await jonas.get('/auth/session')).customer).not.toBeNull();
  });
});

describe('address book', () => {
  it('lists the default first', async () => {
    const list = json(await maya.get('/account/addresses')).items;
    expect(list.map((a: { city: string; isDefault: boolean }) => [a.city, a.isDefault])).toEqual([
      ['Portland', true],
      ['Bend', false],
    ]);
    expect(list[0].countryName).toBe('United States');
  });

  it('the first address of a new customer becomes the default', async () => {
    const c = new Client(t.app);
    await c.post('/auth/register', { name: 'Lena Moss', email: 'lena@example.com', password: 'a long walk in the woods' });
    const list = json(await c.post('/account/addresses', address())).items;
    expect(list[0]).toMatchObject({ isDefault: true, countryCode: 'US' });
  });

  it('a new default replaces the old one: always exactly one', async () => {
    const list = json(await maya.post('/account/addresses', address({ isDefault: true }))).items;
    expect(list.filter((a: { isDefault: boolean }) => a.isDefault).map((a: { city: string }) => a.city)).toEqual(['Eugene']);
    const bend = list.find((a: { city: string }) => a.city === 'Bend');
    const after = json(await maya.post(`/account/addresses/${bend.id}/default`)).items;
    expect(after.filter((a: { isDefault: boolean }) => a.isDefault).map((a: { city: string }) => a.city)).toEqual(['Bend']);
  });

  it('removing the default promotes the newest remaining address', async () => {
    await maya.post('/account/addresses', address({ city: 'Salem' }));
    const list = json(await maya.get('/account/addresses')).items;
    const after = json(await maya.delete(`/account/addresses/${list[0].id}`)).items;
    expect(after.find((a: { isDefault: boolean }) => a.isDefault).city).toBe('Salem');
  });

  it('the default cannot just be switched off', async () => {
    const [home] = json(await maya.get('/account/addresses')).items;
    const res = await maya.put(`/account/addresses/${home.id}`, address({ isDefault: false }));
    expect(json(res).errors[0].path).toBe('isDefault');
  });

  it('holds at most 5 addresses', async () => {
    for (const city of ['A-town', 'B-town', 'C-town']) expect((await maya.post('/account/addresses', address({ city }))).statusCode).toBe(201);
    const res = await maya.post('/account/addresses', address({ city: 'F-town' }));
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe('address_limit_reached');
  });

  it('two requests at once still stop at 5', async () => {
    await maya.post('/account/addresses', address({ city: 'C1' }));
    await maya.post('/account/addresses', address({ city: 'C2' }));
    const results = await Promise.all([1, 2, 3].map((i) => maya.post('/account/addresses', address({ city: `R${i}` }))));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(json(await maya.get('/account/addresses')).items).toHaveLength(5);
  });

  it('checks every field and the country', async () => {
    const res = await maya.post('/account/addresses', { name: '', line1: '', city: '', postcode: '1', countryCode: 'x', phone: 'call me' });
    expect(json(res).errors.map((e: { path: string }) => e.path).sort()).toEqual(['city', 'countryCode', 'line1', 'name', 'phone', 'postcode']);
    expect(json(await maya.post('/account/addresses', address({ countryCode: 'ZZ' }))).errors[0]).toEqual({
      path: 'countryCode',
      message: 'Choose a country from the list.',
    });
  });

  it("are private: another customer's address is a 404", async () => {
    const [home] = json(await maya.get('/account/addresses')).items;
    const jonas = new Client(t.app);
    await jonas.login('jonas@halden.test', PASSWORDS.shopper);
    expect((await jonas.put(`/account/addresses/${home.id}`, address())).statusCode).toBe(404);
    expect((await jonas.delete(`/account/addresses/${home.id}`)).statusCode).toBe(404);
    expect((await jonas.post(`/account/addresses/${home.id}/default`)).statusCode).toBe(404);
  });
});

describe('QA lab', () => {
  it('shows mail for addresses testers create, but hides the demo accounts from non-admins', async () => {
    await new Client(t.app).post('/auth/register', { name: 'Lena Moss', email: 'lena@example.com', password: 'a long walk in the woods' });
    const inbox = json(await new Client(t.app).get('/qa/inbox?email=lena@example.com')).items;
    expect(inbox[0]).toMatchObject({ template: 'verify_email', links: [expect.stringContaining('/verify-email?token=')] });

    await new Client(t.app).post('/auth/forgot-password', { email: 'maya@halden.test' });
    expect(json(await new Client(t.app).get('/qa/inbox?email=maya@halden.test')).items).toEqual([]);
    const admin = new Client(t.app);
    await admin.login('admin@halden.test', PASSWORDS.staff);
    expect(json(await admin.get('/qa/inbox?email=maya@halden.test')).items).toHaveLength(1);
  });

  it('only admins move the shop clock, and only forward', async () => {
    expect(json(await maya.put('/qa/clock', { offsetSeconds: 3600 })).code).toBe('forbidden');
    const admin = new Client(t.app);
    await admin.login('admin@halden.test', PASSWORDS.staff);
    expect(json(await admin.put('/qa/clock', { offsetSeconds: -1 })).code).toBe('validation_failed');
    const res = json(await admin.put('/qa/clock', { offsetSeconds: 86400 }));
    expect(res.offsetSeconds).toBe(86400);
    expect(new Date(res.now).getTime()).toBeGreaterThan(Date.now() + 86000_000);
    expect(json(await new Client(t.app).get('/qa/clock')).offsetSeconds).toBe(86400);
  });
});
