# Halden Outfitters

An outdoor-gear web shop built as a **test target for QA**. It behaves like a production store: a real API
with business rules for checkout, payments, cancellations, returns, refunds, store credit, loyalty points and
reviews; a staff console for support, warehouse and admin; and **18 planted bugs** you can switch on to practise
catching them, each one caught by a SQL rule in [`qa/rules.sql`](qa/rules.sql).

> Halden Outfitters is not a real store. Nothing is for sale, and payments go to **HaldenPay**, a mock card
> provider with test card numbers.

This is **v2** (branch `v2`). v1, a single Node function with plain HTML pages, is what
[halden-outfitters.vercel.app](https://halden-outfitters.vercel.app) still serves until v2 is deployed.

## What's in it

| | |
|---|---|
| **API** | Fastify 5 + TypeScript, OpenAPI 3.1 with a docs UI at `/api/v1/docs`, RFC 9457 errors with stable codes, server-side sessions, Postgres-backed rate limits, idempotency keys, signed webhooks, an injectable shop clock |
| **Storefront** | Next.js 16 + React 19, Tailwind v4, the "Alpine Signal" design (condensed editorial type, one signal-orange accent, light and dark), native View Transitions and scroll-driven motion, mobile first, with CI performance budgets |
| **Staff console** | Order and returns queues, warehouse pick, pack and ship, return grading, product editing with optimistic locking, stock, review moderation, customers and roles, coupons, shipping and tax, audit log |
| **QA lab** | Planted bugs, the shop clock (jump 31 days to test the return window), sweeps, webhook replay, a fake inbox |
| **Database** | PostgreSQL with forward-only migrations; constraints guard rows, `qa/rules.sql` guards the rules between tables |

Layout: `apps/api`, `apps/web`, `packages/contracts` (Zod schemas shared by both), `packages/money` (integer-cent
arithmetic and exact allocation), `db/migrations`, `qa/` (Propmaster rules, recipes and scenarios).

## The business rules (short version)

The full rules are in [docs/DESIGN.md](docs/DESIGN.md) section 3; each service file starts with the rules it
enforces.

- **Checkout:** no guest checkout, email must be verified. Stock rows are locked in id order, so two shoppers can't
  both buy the last unit. The stock is held for 30 minutes while the card is confirmed; an unpaid order is cancelled
  after that.
- **Prices:** one coupon per order (percent, fixed or free shipping; minimum spend, use limits, per-customer limits,
  first order only, excluded categories, sale items excluded). Shipping by zone (domestic 7.95, free from 75.00;
  Europe 14.95, free from 150.00; rest of world 24.95). Tax 8% on goods after discounts. Discounts, points and tax are
  allocated to each line, so any later refund is exact to the cent.
- **Payments:** the card is authorized at checkout and charged when the order ships. Cancelling voids the hold.
  Test cards include declines, insufficient funds, a bank step and a later dispute.
- **Orders:** pending payment, confirmed, packed, shipped, delivered, completed (or cancelled). Customers cancel until
  packing, support until shipping.
- **Returns:** within 30 days of delivery (holiday orders until 31 January), returnable products only. Damaged, wrong
  or not-as-described returns up to 150.00 are approved straight away with a free label; others pay a 4.95 label fee
  and wait for support. Opened items pay a 15% restocking fee unless the shop was at fault. Damaged-by-customer items
  get nothing; faulty ones are refunded and written off.
- **Refunds:** to the card or as store credit. Never more than was paid, per line and per order. Goodwill refunds:
  support up to 50.00 per order, admin any amount.
- **Halden Points:** 1 point per 1.00 of goods (1.5 for Summit members), pending until the return window closes,
  100 points = 5.00 at checkout (at most half the order), given back on cancel and return, expire after 12 months.
- **Reviews:** verified buyers only, one per product, held for support if they contain a link, an email address or
  a blocked word. The product rating is the average of published reviews only.
- **Staff:** every action is checked against the role in the service and written to the audit log with the request
  id.

## Planted bugs

Sign in as admin and open **QA lab** (`/qa`). Switch a bug on, do what "how to see it" says, then run the rules:
exactly one rule fails. `apps/api/test/rules.test.ts` proves this for every bug on every CI run.

| # | Bug | Rule in `qa/rules.sql` that catches it |
|---|---|---|
| 1 | Coupon applied twice with 2+ products | The discount is exactly what the coupon gives |
| 2 | Cancelling keeps the stock held | Open stock holds belong to open orders |
| 3 | Payment misses shipping | The card is authorized for what the order leaves to pay |
| 4 | Coupon use limit ignored | A coupon is never used more often than allowed |
| 5 | Per-customer coupon limit ignored | A customer never uses a coupon more often than allowed |
| 6 | Cancel keeps the coupon use | Cancelled orders hold no coupon use |
| 7 | Cancel leaves the card authorized | Cancelled orders have no open authorization |
| 8 | Europe charged the domestic rate | Shipping matches the zone rate |
| 9 | Refund ignores the coupon share | A line is never refunded more than was paid for it |
| 10 | Refunds can exceed the payment | Refunds never exceed what was paid |
| 11 | A cancelled return restarts the window | Returns are requested within 30 days of delivery |
| 12 | Damaged returns go back on the shelf | Written-off returns are never restocked |
| 13 | Store-credit refunds also refund the card | Each refund is paid out once |
| 14 | Support can refund any amount as goodwill | Support goodwill refunds stay within 50.00 per order |
| 15 | Points earned on tax and shipping | Points are earned on goods only |
| 16 | Returned items keep their points | Returned lines hold no points |
| 17 | Hidden reviews still count in the rating | A product rating is the average of its published reviews |
| 18 | Price edits rewrite past orders | An order subtotal is the sum of its lines |

## QA with Propmaster

[Propmaster](https://github.com/rameshlakmal/propmaster) records what each test step changed in the database and
checks the rules against exactly those rows:

```sh
propmaster record start "Return a damaged mug" # then click through the test, marking steps:
propmaster record step "Grade it faulty"
propmaster record stop
propmaster record check qa/rules.sql          # which rules the session broke, with the offending rows
propmaster find --recipes qa/recipes "open return window" --claim
propmaster seed --scenarios qa/scenarios delivered-order-for-return
```

## Run it

Needs Node 22.12+ (24 recommended) and PostgreSQL 13+. Full guide: [docs/DEVELOPING.md](docs/DEVELOPING.md).

```sh
npm install
cp apps/api/.env.example apps/api/.env     # fill in the two SEED_*_PASSWORD values
npm run db:reset                            # migrate and seed a local database
npm run dev                                 # API on http://127.0.0.1:4000, shop on http://localhost:3001
```

Demo accounts (passwords are the ones you put in `apps/api/.env`):

| Role | Email | Can |
|---|---|---|
| Admin | admin@halden.test | everything, including the QA lab |
| Support | support@halden.test | orders, cancellations, returns decisions, goodwill up to 50.00, reviews, customers |
| Warehouse | warehouse@halden.test | pack, ship, deliver, receive and grade returns, stock |
| Shoppers | maya@, jonas@, ari@halden.test | order history, a delivered order to return, reviews |

## Tests

| | |
|---|---|
| `npm test` | unit tests (pricing, refund maths, state machine) and API integration tests against real Postgres, including concurrency races and the planted-bug proof |
| `npm run test:e2e` | Playwright journeys on desktop and mobile: browse, check out, pay at the bank step, cancel, return, review, staff console |
| CI | lint, format, typecheck, all of the above, a first-load JavaScript budget and Lighthouse budgets on mobile |

API guide: [docs/API.md](docs/API.md). Licence: MIT.
