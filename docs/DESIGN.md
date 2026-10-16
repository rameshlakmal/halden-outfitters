# Halden Outfitters v2: design

Status: **draft for review** (2026-10-17). No code is written until this is approved.

## 1. Goal

Rebuild Halden Outfitters so it behaves like a real production shop: a proper API with real business rules
(cancellations, returns, refunds, payments, stock, staff roles), built with production practices. It stays a
**QA test target**: the richer the rules, the more realistic the bugs that Propmaster, API tests and UI tests can find.

What stays the same:
- PostgreSQL, money as `numeric(10,2)` in the database (easy to check with SQL), integer cents in code.
- The QA lab with planted bugs, each one breaking exactly one rule in `qa/rules.sql`.
- The look and feel (Geist, Phosphor icons, current colours and photos), moved into React.
- Free hosting on Vercel + Neon, the live URL https://halden-outfitters.vercel.app.

Decided on 2026-10-17: **Fastify + TypeScript** API, **Next.js (React)** frontend, **Vercel + Neon** hosting.

## 2. Architecture

```
Browser ──► Next.js app (Vercel project "halden-outfitters")
              │  pages, server components
              │  rewrite /api/v1/*  (same origin, so cookies just work)
              ▼
            Fastify API (Vercel project "halden-api")
              routes ─► services (business rules) ─► repositories (SQL) ─► Neon Postgres
              │
              └─► mock payment gateway "HaldenPay" (in-process, signed webhooks)
```

- The browser only ever talks to the Next.js origin. Next.js forwards `/api/v1/*` to the API project, so
  session cookies stay first-party (`*.vercel.app` is a public suffix, so two vercel.app hosts can't share cookies).
- The API is also reachable directly for API testing (Postman, Playwright `request`, Swagger UI).

### Repository layout (npm workspaces, one repo)

```
apps/
  api/                 Fastify API
    src/
      core/            config, db pool + transactions, errors, logger, auth/session, idempotency,
                       rate limit, audit log, clock, permissions
      modules/
        catalog/       routes.ts  service.ts  repository.ts  schemas.ts
        cart/
        accounts/
        checkout/
        orders/
        payments/      gateway interface + HaldenPay mock + webhooks
        returns/
        refunds/
        inventory/
        promotions/
        shipping/      zones, rates, tax
        staff/         admin console endpoints
        qa-lab/        planted bugs, shop clock, fake inbox, webhook replay
      jobs/            sweeps (expire reservations, auto-complete orders)
    test/
  web/                 Next.js app (App Router)
packages/
  contracts/           Zod schemas shared by API and web: request/response types, error codes
  money/               cents helpers, rounding, allocation
db/
  migrations/          numbered SQL migrations (node-pg-migrate, SQL files)
  seed/                demo catalogue, customers, staff, orders in every state
qa/
  rules.sql            Propmaster rule checks
  recipes/             Propmaster Finder recipes
  scenarios/           Propmaster Seeder scenarios
docs/
```

### Libraries

| Need | Choice | Why |
|---|---|---|
| HTTP | Fastify 5 | fast, schema-first, mature plugin set |
| Validation + types | Zod + `fastify-type-provider-zod` | one schema gives validation, TS types and OpenAPI |
| API docs | `@fastify/swagger` + Scalar UI at `/api/v1/docs` | live OpenAPI 3.1 spec for API testers |
| DB | `pg` with hand-written SQL in repositories | SQL stays visible (portfolio), no ORM magic |
| Migrations | node-pg-migrate (SQL files) | forward-only, versioned, runs in CI and on deploy |
| Passwords | `@node-rs/argon2` (argon2id) | current OWASP advice; works on Vercel |
| Logging | pino (JSON) with request IDs | structured, cheap |
| Frontend | Next.js 15, React 19, TanStack Query, React Hook Form + Zod | standard production stack |
| Tests | Vitest, Fastify `inject`, Playwright | unit → API → E2E |
| Quality | ESLint, Prettier, `tsc --noEmit`, GitHub Actions | |

## 3. Business rules

All rules live in services, never in routes or the frontend. The frontend shows what the API allows
(each resource returns its `allowedActions`, e.g. `["cancel", "requestReturn"]`).

### 3.1 Order lifecycle

```
                 ┌──────── payment fails / 30 min timeout ────────┐
                 ▼                                                │
checkout ─► pending_payment ─► confirmed ─► packed ─► shipped ─► delivered ─► completed
                 │                │            │
                 └────────────────┴────────────┴──► cancelled
```

| Status | Meaning | Payment | Stock |
|---|---|---|---|
| `pending_payment` | card needs an extra step (test card `4000 0000 0000 3220`) | `requires_action` | reserved, 30 min |
| `confirmed` | card authorized | `authorized` | reserved |
| `packed` | warehouse packed it | `authorized` | reserved |
| `shipped` | handed to carrier; **payment captured now** | `captured` | taken off on-hand |
| `delivered` | carrier confirmed (staff marks it, or QA lab) | `captured` | |
| `completed` | 30 days after delivery with no open return | | |
| `cancelled` | see 3.2 | `voided` | reservation released |

- Every transition is checked against this table. Anything else is `409 invalid_transition`.
- Every transition writes `order_events` (who, when, from, to, note).
- `completed` is applied lazily (on read and by the daily sweep), see 4.6.

### 3.2 Cancellation

| Who | Allowed while | Reason |
|---|---|---|
| Customer | `pending_payment`, `confirmed` | required: `changed_mind`, `ordered_by_mistake`, `found_cheaper`, `delivery_too_slow`, `other` (+ text) |
| Support, admin | up to `packed` | required, plus internal note |
| Anyone | `shipped` or later | **not allowed**: use a return (3.3) |
| System | `pending_payment` older than 30 min | `payment_timeout` |

Effects, in one transaction:
1. Order → `cancelled`, event written.
2. Payment authorization **voided**. No money moved, so there is no refund. This is the real-world reason for authorize-then-capture.
3. Stock reservations released.
4. Coupon use given back (`used_count - 1`), so a cancelled order doesn't burn a limited code.
5. Store credit used on the order goes back to the customer's balance.
6. "Order cancelled" email queued to the outbox.

### 3.3 Returns

A customer can request a return when **all** of these hold:
- The order is `delivered` or `completed`.
- It's within **30 days of delivery** (the shop clock's date, inclusive). Orders delivered between 15 Nov and 31 Dec can be returned until 31 Jan (holiday policy).
- Each product is returnable (`products.returnable`; e.g. opened gas canisters and food are final sale).
- Each line's quantity ≤ ordered − already returned or in an open return.
- There's no other open return for the same order.

Flow:
```
requested ─► approved ─► received ─► refunded
    │            │           │
    └─► rejected └─► expired (label not used in 14 days)
                             └─► partially_refunded (some lines failed inspection)
```

- **Auto-approval:** shop-fault reasons (`damaged`, `wrong_item`, `not_as_described`) on returns worth ≤ 150.00 are approved straight away. Everything else, and customers with 3+ returns in 90 days, goes to support for review.
- **Return shipping:** free for shop-fault reasons. For other reasons a 4.95 label fee is taken off the refund.
- **Inspection on receipt (warehouse):** each line is graded:
  - `as_new`: full refund, back to sellable stock.
  - `opened`: 15% restocking fee unless shop fault, back to stock.
  - `damaged_by_customer`: line rejected, no refund, item written off.
  - `faulty`: full refund, written off, not restocked.

### 3.4 Refund amounts

At checkout the order discount and tax are **allocated to each line** (proportional to line total; leftover
cents go to the largest line) and stored on `order_items`. This makes the refund for any part of an order exact:

```
line refund  = (unit_price × qty_returned) − allocated_discount_share + allocated_tax_share
order refund = Σ line refunds
             − restocking fees
             − return label fee (customer reasons only)
             + original shipping (only when shop fault AND every item of the order is returned)
```

Hard limits (checked in the service and again by a DB rule):
- Total refunded on an order ≤ amount captured.
- A refund never exceeds what the customer paid for that line.

**Refund method:** back to the original card (default), or **store credit** (instant, goes to a
`store_credit_ledger`). Store credit can pay for later orders, alone or with a card.

**Goodwill refunds** (no return, e.g. late delivery) are staff-only: support up to 50.00 per order, admin
unlimited. They need a reason and are written to the audit log.

### 3.5 Payments (HaldenPay mock gateway)

- Behind a `PaymentGateway` interface: `authorize`, `capture`, `void`, `refund`. A real Stripe adapter could replace it.
- Test cards (like real gateways' test pages):

  | Card | Result |
  |---|---|
  | `4242 4242 4242 4242` | success |
  | `4000 0000 0000 0002` | declined |
  | `4000 0000 0000 9995` | insufficient funds |
  | `4000 0000 0000 3220` | requires action → `pending_payment`, confirmed on a "bank" page |
  | `4000 0000 0000 0259` | succeeds, then a **dispute** webhook arrives later |

- Webhooks: HaldenPay posts signed events (`HMAC-SHA256` header) to `/api/v1/webhooks/haldenpay`. The API checks the signature, stores the event ID and ignores duplicates. The QA lab can resend any event to test that.
- **Idempotency:** `POST /checkout`, refunds and goodwill refunds need an `Idempotency-Key` header. The same key with the same body returns the first response, the same key with a different body returns `422`. A double-clicked Pay button charges once.

### 3.6 Inventory

- `inventory.on_hand` (physically in the warehouse) and `stock_reservations` (held for open orders).
  **Available = on_hand − active reservations.** Checkout only sells what's available.
- Reservations are made at checkout and released on cancel, or turned into a `sale` movement when the order ships.
- Every change to `on_hand` writes `stock_movements` (`initial`, `sale`, `return`, `restock`, `write_off`, `adjustment`), so stock always reconciles.
- Stock rows are locked in product-ID order at checkout, so two shoppers can't buy the last item (this is kept from v1).
- Low-stock threshold per product. Going under it queues a staff email.

### 3.7 Promotions

- One coupon per order. Kinds: `percent`, `fixed`, `free_shipping`.
- Conditions: active, start/end dates, minimum subtotal (after excluded items), global use limit,
  **per-customer limit**, **first order only**, **excluded categories**, and sale items excluded by default.
- A fixed coupon never makes the subtotal negative. Shipping is never discounted except by `free_shipping`.
- Use is counted when the order is confirmed and given back on cancel (3.2).

### 3.8 Shipping and tax

| Zone | Countries | Standard | Express | Free standard from |
|---|---|---|---|---|
| Domestic | home country | 7.95 | 14.95 | 75.00 after discount |
| Europe | EU list | 14.95 | 29.95 | 150.00 |
| Rest of world | others | 24.95 | n/a | never |

- Tax rate per zone (domestic 8%, Europe 20%, rest of world 0%), charged on the discounted subtotal + shipping, rounded half-up per order.
- Rates live in tables, not code, so staff can change them and rules can check them.

### 3.9 Accounts and security

- Register → **verify email** (link in the fake inbox) before the first checkout.
- Login lockout: 5 failed attempts → locked for 15 min. Password reset tokens are single-use, valid 1 h and stored hashed.
- Server-side sessions (`sessions` table, revocable, 14-day sliding expiry) in an `HttpOnly; Secure; SameSite=Lax` cookie. "Sign out everywhere" is supported.
- Address book: up to 5 addresses, one default. Each order copies the address it used.
- Guest checkout is out of scope (keeps the rules simpler).

### 3.10 Staff roles

| Permission | customer | support | warehouse | admin |
|---|---|---|---|---|
| View any order | | ✓ | ✓ | ✓ |
| Cancel order (up to packed) | own, before packing | ✓ | | ✓ |
| Approve / reject return | | ✓ | | ✓ |
| Pack, ship, mark delivered, receive return, grade items | | | ✓ | ✓ |
| Goodwill refund | | ≤ 50.00 | | ✓ |
| Products, prices, stock adjustments | | | stock only | ✓ |
| Coupons, shipping rates, tax | | | | ✓ |
| Staff accounts, QA lab | | | | ✓ |

- Permissions are checked in services (`can(actor, 'refund.goodwill', order)`), not just by hiding buttons.
- Every staff action writes `audit_log` (actor, action, entity, before/after JSON, request ID).
- Product edits use **optimistic locking** (`version` column, `If-Match` header → `412` if someone else saved first).

### 3.11 Notifications

Emails are written to an `outbox` table in the same transaction as the change, then "sent" to a **fake inbox**
(a QA lab page per email address). Testers can check that the right email went out with the right amounts.

## 4. Production practices

### 4.1 API conventions
- Versioned under `/api/v1`. JSON only, camelCase, money as strings with 2 decimals (`"64.00"`).
- Errors use RFC 9457 `application/problem+json`:
  `{ type, title, status, detail, code: "return_window_closed", errors: [{ path, message }], requestId }`.
  Every error code is listed in `packages/contracts`.
- Cursor pagination (`?limit=20&cursor=…`), filters on list endpoints, `ETag` on editable resources.
- `X-Request-Id` on every response, and in every log line.

### 4.2 Security
- Writes must be JSON with a matching `Origin` (CSRF), SameSite cookies, security headers and CSP on Next.js.
- Rate limits are stored in Postgres, because serverless instances share no memory: login 10/min per IP+email, checkout 20/min per customer.
- Config is validated with Zod at startup, so a missing secret fails the deploy, not a request.
- The app's DB role can't drop tables; migrations use a separate role.
- No string-built SQL, ever. Repositories use bind parameters only.

### 4.3 Data
- Forward-only SQL migrations, run in CI and before each production deploy.
- `CHECK`, `FK` and unique constraints guard single rows. Cross-table rules are the app's job and are checked by `qa/rules.sql` (as in v1, on purpose).
- All business time comes from an injected **clock**, so tests and the QA lab can move time (e.g. jump 31 days to test the return window).

### 4.4 Testing

| Level | Tool | What |
|---|---|---|
| Unit | Vitest | pricing, allocation, refund maths, state machine, coupon rules, permissions (table-driven) |
| Integration | Vitest + real Postgres (Docker locally, service container in CI) | services and repositories, concurrency (two checkouts for the last item, two refunds at once) |
| API / contract | Fastify `inject` + OpenAPI response validation | every endpoint, every error code, auth and permissions |
| E2E | Playwright | shopper journeys: buy, cancel, return, refund; staff journeys |
| DB rules | Propmaster `record check qa/rules.sql` | zero violations after the whole suite. Each planted bug breaks exactly its rule. |

CI on GitHub Actions: lint → typecheck → unit → integration → API → build → E2E against a preview deploy.

### 4.5 Observability
- `GET /api/v1/health` (DB ping) and `GET /api/v1/version` (git SHA).
- JSON logs with request ID, user ID and duration. Errors are logged with stack traces, and clients get a generic message.

### 4.6 Hosting limits and how the design handles them
- **Vercel Hobby cron runs once a day**, so timed rules (30-min payment timeout, reservation expiry, auto-complete after 30 days) are **applied lazily**: queries treat an expired reservation as released, and the order is moved to its new status the next time it's read or touched. The daily cron sweeps up the rest, and the QA lab has a "Run sweeps now" button.
- Neon: use the pooled connection string, with small pools per function instance.

## 5. QA lab v2: planted bugs

Each bug is off by default, switched on in the QA lab, and breaks exactly one rule in `qa/rules.sql`.

| # | Bug | Rule it breaks |
|---|---|---|
| 1 | Coupon applied twice with 2+ products (v1) | discount = what the coupon gives |
| 2 | Cancelling keeps the stock reserved (v1, adapted) | reservations match open orders |
| 3 | Payment misses shipping (v1) | authorized amount = order total |
| 4 | Price edits rewrite past orders (v1) | order subtotal = its lines |
| 5 | Coupon use limit ignored (v1) | uses ≤ limit |
| 6 | Per-customer coupon limit ignored | uses per customer ≤ limit |
| 7 | Refund ignores the coupon share | line refund ≤ amount paid for the line |
| 8 | Second partial refund skips the "already refunded" check | refunds ≤ captured |
| 9 | Return window counted from order date, not delivery | returns requested within window |
| 10 | Cancel doesn't give back the coupon use | coupon uses = non-cancelled orders |
| 11 | Damaged returns go back to sellable stock | written-off items not restocked |
| 12 | Cancel leaves the authorization open | cancelled orders have voided payments |
| 13 | Europe orders get the domestic shipping rate | shipping = zone rate |
| 14 | Store-credit refund also refunds the card | refunded total = refund amount |
| 15 | Support can goodwill-refund over 50.00 | support goodwill ≤ 50.00 |

## 6. Delivery phases

Each phase is a vertical slice: migrations + API + frontend pages + tests + rules + docs, deployed and
pushed before the next one starts. The v1 site stays live until phase 2 reaches parity.

| Phase | Scope | Done when |
|---|---|---|
| **1. Foundation** | monorepo, Fastify core (config, errors, logging, sessions, OpenAPI, health), migrations, CI, both Vercel projects, Next.js shell in the current design. Catalog, cart, accounts (verify email, reset, lockout, addresses), fake inbox | shopper can browse, sign up, verify, fill a cart on the new stack |
| **2. Checkout and orders** | HaldenPay, idempotency, shipping zones, tax, coupons v2, reservations, order lifecycle, cancellation, webhooks | parity with v1 plus the new rules; live URL switches to v2 |
| **3. Returns and refunds** | return requests, auto-approval, inspection, refund maths, store credit, goodwill refunds | every rule in 3.3 and 3.4 has tests |
| **4. Staff console** | roles and permissions, audit log, warehouse pick/pack/ship, product admin with locking, QA lab v2 (15 bugs, shop clock, sweeps, webhook replay) | every bug flips exactly its rule |
| **5. Hardening and release** | full Playwright suite, concurrency tests, Propmaster recipes, scenarios and rules for the new schema, README, API guide, v2.0.0 release | CI green, all docs written |

## 7. Risks and open questions

- **Size:** this is several times the current codebase. Phases keep it shippable at every step.
- **Propmaster assets break:** recipes, scenarios and rules all reference the v1 schema. They're rewritten per phase, not at the end.
- **Two Vercel projects:** the proxy adds a little latency, but keeps cookies simple. The alternative (Fastify inside a Next.js route) is possible if this hurts.
- **Cold starts:** Fastify boots fast. OpenAPI generation is done at build time, not per cold start.
- **Open questions for you:**
  1. Home country and currency: keep v1's (no currency symbol shown, 8% tax), or pick one (e.g. UK, GBP, 20% VAT)?
  2. Do you want product reviews (verified buyers only) or a loyalty-points scheme in scope? Both add more rules to test. I've left them out for now.
  3. Should guest checkout stay out?
