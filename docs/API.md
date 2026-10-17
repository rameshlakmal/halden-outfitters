# Halden API guide

The full reference is generated from the code: an interactive OpenAPI 3.1 page at `/api/v1/docs` (try any
request in the browser; the raw spec is linked from it). This guide covers what the reference can't: how the pieces fit,
and how to test against them.

Base URL: `http://127.0.0.1:4000/api/v1` locally, or `/api/v1` through the web app (same origin, which is what the
browser uses).

## Conventions

- **JSON only**, camelCase. Money is a string with two decimals (`"64.00"`); never parse it to a float for maths.
- **Writes** (POST, PUT, PATCH, DELETE) must send `Content-Type: application/json` and an `Origin` the API allows.
  This is the CSRF defence, so a curl test needs `-H "Origin: http://localhost:3001"`.
- **Sessions** are a cookie (`halden_session`, HttpOnly, SameSite=Lax) set by `POST /auth/login`. They slide: each
  use within 14 days keeps them alive. `POST /auth/logout` ends one; changing the password ends the others.
- **Request ids:** every response has `X-Request-Id`. Send your own (8 to 100 safe characters) to follow one request
  through the logs and the audit log.
- **Lists** are cursor-paginated: `?limit=20&cursor=<nextCursor from the last page>`. `nextCursor: null` means the end.
- **Time:** business rules use the shop clock, which the QA lab can move ahead. `GET /qa/clock` shows it.

## Errors

Every error is `application/problem+json` (RFC 9457) with a stable `code`. Branch on `code`, never on the text:

```json
{
  "type": "https://halden-outfitters.vercel.app/problems/return_not_allowed",
  "title": "This cannot be returned",
  "status": 409,
  "detail": "The return window for this order closed on 2026-11-16.",
  "code": "return_not_allowed",
  "requestId": "6f1c..."
}
```

Form errors add `errors: [{ path, message }]` (paths like `items.0.qty`). Rate limits add `retryAfterSeconds` and a
`Retry-After` header. The codes and their fixed HTTP statuses are in `packages/contracts/src/errors.ts`.

| Status | Codes you will meet |
|---|---|
| 400 | `validation_failed`, `invalid_json`, `idempotency_key_missing` |
| 401 | `unauthenticated`, `invalid_credentials`, `webhook_signature_invalid` |
| 402 | `payment_declined`, `payment_failed` |
| 403 | `forbidden`, `origin_not_allowed`, `email_not_verified`, `review_not_allowed` |
| 404 | `not_found`, `route_not_found` |
| 409 | `invalid_transition`, `out_of_stock`, `not_enough_stock`, `coupon_invalid`, `cart_has_problems`, `return_not_allowed`, `refund_limit_exceeded`, `already_reviewed`, `idempotency_in_progress` |
| 410 | `token_invalid` (used or expired email link) |
| 412 / 428 | `precondition_failed` / `precondition_required` (product edits, see below) |
| 422 | `idempotency_key_reused` |
| 423 | `account_locked` (5 wrong passwords: 15 minutes) |
| 429 | `rate_limited` |

## A purchase, end to end

```text
POST /auth/register            { name, email, password }        -> 201, signed in, verification email
POST /auth/verify-email        { token }                         (token from the email, see the inbox below)
POST /cart/items               { productId, qty }
POST /cart/coupon              { code: "WELCOME10" }             -> the cart with the discount
POST /checkout/quote           { shipTo: { addressId }, shippingMethod, pointsToRedeem, useStoreCredit }
POST /checkout                 same body + card                  Idempotency-Key: <uuid>
     201 { orderId, status: "confirmed", nextAction: null }
     202 { orderId, status: "pending_payment", nextAction: { type: "authenticate", url } }
     402 payment_declined
POST /payments/authenticate    { token, approve }                (the bank step for card ...3220)
GET  /orders/:id               -> the order, with allowedActions for you
```

`allowedActions` is the source of truth for buttons: `cancel`, `pay`, `return` for the customer; `pack`, `ship`,
`deliver`, `goodwill` for staff.

**Test cards** (any future expiry, any CVC):

| Card | What happens |
|---|---|
| 4242 4242 4242 4242 | authorized |
| 4000 0000 0000 0002 | declined (402) |
| 4000 0000 0000 9995 | insufficient funds (402) |
| 4000 0000 0000 3220 | needs the bank step (202), then authorized or failed |
| 4000 0000 0000 0259 | authorized; a dispute webhook arrives after capture |

**Idempotency.** `POST /checkout` and `POST /staff/orders/:id/goodwill` need an `Idempotency-Key` header. The same
key with the same body returns the first response (a double click charges once); with a different body it's 422; a
repeat while the first is still running gets 409.

## After the purchase

```text
POST /orders/:id/cancel              { reason, note? }      customer until packed, support until shipped
POST /staff/orders/:id/pack                                 warehouse
POST /staff/orders/:id/ship          { trackingNumber }     the card is charged now
POST /staff/orders/:id/deliver                              points are earned now (pending)
POST /orders/:id/returns             { items: [{ productId, qty }], reason, note?, refundMethod }
POST /staff/returns/:id/approve | /reject { reason }        support
POST /staff/returns/:id/receive      { items: [{ productId, condition }] }   warehouse: refund happens here
POST /returns/:id/cancel                                    customer, before it's received
POST /staff/orders/:id/goodwill      { amount, reason, method }   Idempotency-Key
GET  /account/points, /account/store-credit
```

Return conditions: `as_new` (full refund, restocked), `opened` (15% restocking fee unless shop fault, restocked),
`damaged_by_customer` (no refund, written off), `faulty` (full refund, written off).

## Reviews

```text
GET  /products/:slug/reviews?sort=helpful|newest|highest|lowest&rating=5   summary + viewer.canReview
POST /products/:slug/reviews        { rating, title, body, fit? }   verified buyers; may come back "pending"
PUT  /reviews/:id                   edit, within 30 days
DELETE /reviews/:id
PUT | DELETE /reviews/:id/helpful   204
POST /staff/reviews/:id/hide { reason } | /publish                   support
```

## Staff writes and optimistic locking

`GET /staff/products/:id` returns an `ETag` with the product's version. Send it back on save:

```text
PATCH /staff/products/42
If-Match: "3"
{ "price": "49.00" }
```

No `If-Match` is 428. A stale version (someone saved since you loaded) is 412 and nothing changes. The new version
comes back as the next `ETag`. Every staff write is in `GET /staff/audit` (admin), with before, after and the
request id.

## QA endpoints

Only while the QA lab is enabled (`QA_LAB_ENABLED`). All but the inbox are admin only:

| | |
|---|---|
| `GET /qa/inbox?email=<address>` | the fake inbox: every email the shop "sent" there (verification links, order confirmations, refunds). Open to anyone for test addresses; the seeded demo accounts' mail is admin only |
| `GET /qa/bugs`, `PUT /qa/bugs/:key { enabled }` | the planted bugs |
| `GET /qa/clock`, `PUT /qa/clock { offsetSeconds }` | move the shop clock ahead; 0 resets it |
| `POST /qa/sweeps` | run the time-based rules now (payment timeouts, label expiry, order completion, points expiry, webhooks) |
| `GET /qa/webhooks?orderId=`, `POST /qa/webhooks/:id/redeliver` | payment events, and resending one to test that a repeat changes nothing |

## Webhooks

HaldenPay posts events to `POST /webhooks/haldenpay` with `HaldenPay-Signature: t=<unix>,v1=<hex HMAC-SHA256 of
"t.body">` using `HALDENPAY_WEBHOOK_SECRET`. Signatures older than 5 minutes are refused, and an event id the shop
has already processed is acknowledged and ignored.
