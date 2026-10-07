# Halden Outfitters

A small outdoor-gear web shop, built as a **test target for database QA**. It looks and works like a real store (catalogue, cart, coupons, checkout, order history, cancellations, a staff admin), and it has **planted bugs** you can switch on to practise catching them.

It is plain HTML, CSS and JavaScript on the front end, one Node function for the API, and PostgreSQL. It hosts free on Vercel with a Neon database.

> Halden Outfitters is not a real store. Nothing is for sale, and payments use test card numbers only.

## Why it exists

Web shops break in the database: a discount counted twice, a refund that never returns stock, a charge that doesn't match the order. Those bugs don't show on the screen. This shop makes them easy to produce on purpose, and `qa/rules.sql` checks every business rule after a test, with [Propmaster](https://github.com/rameshlakmal/propmaster) recording what each step changed.

## The business rules

| Rule | Where |
|---|---|
| Subtotal is the sum of unit price × quantity | `lib/pricing.js` |
| A coupon gives a percentage or a fixed amount, never more than the subtotal, and only while active, unexpired, under its use limit and above its minimum | `lib/pricing.js` |
| Shipping is $7.95, free from $75.00 after the discount | `lib/pricing.js` |
| Tax is 8% of the discounted subtotal, rounded half up to the cent | `lib/pricing.js` |
| Checkout locks the stock rows, refuses to oversell, and charges exactly the total | `lib/routes/orders.js` |
| A paid order can be cancelled until it ships: full refund, items back in stock | `lib/routes/orders.js` |
| Every stock change is a movement, so stock always reconciles | `stock_movements` table |

Money is handled in whole cents and stored as `numeric`, never as floating point.

## Planted bugs (the QA lab)

Sign in as staff, open **Admin, QA lab**, and switch one on. Each bug breaks a rule in `qa/rules.sql`:

| Bug | What goes wrong | Rule that catches it |
|---|---|---|
| Coupon applied twice | With two or more products, the discount doubles | The discount is exactly what the coupon gives |
| Cancelling keeps the stock | A cancelled order never returns its items | A cancelled order returns its items to stock |
| Payment misses shipping | The card is charged the total minus shipping | The card is charged the order total |
| Price edits rewrite past orders | Changing a price also changes old order lines | Order subtotal matches its lines |
| Coupon use limit ignored | A used-up coupon keeps working | A coupon is never used more often than allowed |

The automated tests switch on each bug in turn and check that exactly its rule fails.

## Run it locally

Needs Node 20.12+ and PostgreSQL. The Docker Postgres from the Propmaster repo (port 5433) works as is.

```sh
npm install
cp .env.example .env          # then fill in SESSION_SECRET and the two demo passwords
createdb halden               # or: docker exec <postgres container> psql -U propmaster -c "CREATE DATABASE halden"
npm run db:setup              # tables, catalogue, demo accounts, a few past orders
npm run dev                   # http://localhost:3100
```

Demo accounts (passwords from your `.env`):

| Role | Email |
|---|---|
| Staff (admin) | admin@halden.test |
| Shoppers | maya@halden.test, jonas@halden.test, ari@halden.test |

Test cards: `4242 4242 4242 4242` pays; `4000 0000 0000 0002` is always declined. Coupons: `WELCOME10`, `SAVE20` (orders over $150), `TRAILHEAD15` (used up), `SPRING5` (expired), `STAFF50` (switched off).

`npm run db:setup` resets the shop to this starting state at any time.

## Test it with Propmaster

```sh
propmaster --url postgres://propmaster:propmaster@localhost:5433/halden install
propmaster record start "Small order pays shipping" --auto-steps
#   ... use the shop in the browser ...
propmaster record stop
propmaster record check qa/rules.sql
```

Or use Propmaster's web app (`npm run ui` in the Propmaster repo) with this database as a connection.

## Automated tests

```sh
npm test          # unit tests for money and pricing; API tests against a halden_test database
npm run typecheck
```

The API tests create `halden_test` next to your database, reset it before each test, and run `qa/rules.sql` after every flow.

## Deploy free (Vercel + Neon)

1. Create a free Neon project and copy its **pooled** connection string.
2. Load the shop into it once from your machine: `DATABASE_URL="<neon url>" npm run db:setup` (with the other `.env` values set).
3. Import this repo into Vercel. No build step is needed: `vercel.json` serves `public/` and sends `/api/*` to `api/index.js`.
4. In Vercel's project settings, add `DATABASE_URL` (the pooled Neon string) and `SESSION_SECRET`.

For Propmaster against Neon, use Neon's **direct** (non-pooled) connection string.

## How it's built

```
public/            the site: one HTML file per page, assets/css/app.css, assets/js/ (core.js + one module per page)
api/index.js       the whole API as one serverless function
lib/               router, auth (scrypt, signed session cookie), pricing, money, planted bugs, routes/
db/schema.sql      tables, constraints and indexes
db/seed-data.js    the catalogue and coupons
scripts/           db-setup.js, dev.js (local server), build-assets.js (font and icon sprite)
qa/rules.sql       the business rules, as Propmaster checks
test/              unit and API tests
```

Security basics: passwords are hashed with scrypt; the session is an HttpOnly, SameSite cookie signed with HMAC; every change must be sent as JSON, so other websites can't submit forms on a shopper's behalf; all values are escaped before they reach the page.

## Credits

Type: [Geist](https://vercel.com/font) (SIL Open Font License). Icons: [Phosphor](https://phosphoricons.com) (MIT). Photos: free stock from Pexels and Unsplash, credited per image in [`public/images/CREDITS.md`](public/images/CREDITS.md).
