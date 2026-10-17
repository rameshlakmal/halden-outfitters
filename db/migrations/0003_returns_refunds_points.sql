-- Phase 3: returns, refunds, store credit, goodwill refunds, Halden Points.

-- ---------- orders: points and store credit at checkout ----------

ALTER TABLE orders
  ADD COLUMN points_redeemed    int NOT NULL DEFAULT 0 CHECK (points_redeemed >= 0 AND points_redeemed % 100 = 0),
  ADD COLUMN points_discount    numeric(10, 2) NOT NULL DEFAULT 0 CHECK (points_discount >= 0),
  ADD COLUMN store_credit_used  numeric(10, 2) NOT NULL DEFAULT 0 CHECK (store_credit_used >= 0),
  ADD COLUMN points_earned      int NOT NULL DEFAULT 0 CHECK (points_earned >= 0);

-- Each line's share of the points discount (given back as points on a return) and of the points it earns.
ALTER TABLE order_items
  ADD COLUMN points_alloc   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (points_alloc >= 0),
  ADD COLUMN points_earned  int NOT NULL DEFAULT 0 CHECK (points_earned >= 0);

-- An order paid entirely with store credit has no card payment row.

-- ---------- store credit ----------

CREATE TYPE store_credit_reason AS ENUM ('refund', 'purchase', 'purchase_reversal', 'goodwill', 'adjustment');

-- Store credit as a ledger: the balance is the sum, and it never goes below zero.
CREATE TABLE store_credit_ledger (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  amount       numeric(10, 2) NOT NULL CHECK (amount <> 0),
  reason       store_credit_reason NOT NULL,
  order_id     bigint REFERENCES orders (id),
  refund_id    bigint,
  actor_id     bigint REFERENCES customers (id),
  note         text,
  created_at   timestamptz NOT NULL
);
CREATE INDEX store_credit_customer_idx ON store_credit_ledger (customer_id);

-- ---------- Halden Points ----------

CREATE TYPE points_bucket AS ENUM ('pending', 'available');
CREATE TYPE points_kind AS ENUM ('earn_pending', 'earn_available', 'pending_release', 'redeem', 'redeem_reversal',
                                 'return_reversal', 'expire', 'adjustment');

-- Points as a ledger in two buckets. Pending points (from delivered orders) become available when the
-- order's return window closes. Each row that adds available points tracks how many of them are still unspent
-- (remaining), so spending takes the oldest first and expiry 12 months later is exact.
CREATE TABLE loyalty_ledger (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  bucket       points_bucket NOT NULL,
  kind         points_kind NOT NULL,
  points       int NOT NULL CHECK (points <> 0),
  remaining    int CHECK (remaining IS NULL OR remaining >= 0),
  expires_at   timestamptz,
  order_id     bigint REFERENCES orders (id),
  return_id    bigint,
  actor_id     bigint REFERENCES customers (id),
  note         text,
  created_at   timestamptz NOT NULL,
  CHECK ((remaining IS NOT NULL) = (bucket = 'available' AND points > 0)),
  CHECK (remaining IS NULL OR remaining <= points)
);
CREATE INDEX loyalty_customer_idx ON loyalty_ledger (customer_id);
CREATE INDEX loyalty_unspent_idx ON loyalty_ledger (customer_id, created_at) WHERE remaining > 0;

-- ---------- returns ----------

CREATE TYPE return_status AS ENUM ('requested', 'approved', 'rejected', 'received', 'refunded', 'partially_refunded',
                                   'expired', 'cancelled');
CREATE TYPE return_reason AS ENUM ('damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'too_small',
                                   'too_large', 'not_needed', 'other');
CREATE TYPE item_condition AS ENUM ('as_new', 'opened', 'damaged_by_customer', 'faulty');
CREATE TYPE refund_method AS ENUM ('card', 'store_credit');

CREATE TABLE returns (
  id               bigint GENERATED ALWAYS AS IDENTITY (START WITH 5001) PRIMARY KEY,
  order_id         bigint NOT NULL REFERENCES orders (id),
  customer_id      bigint NOT NULL REFERENCES customers (id),
  status           return_status NOT NULL,
  reason           return_reason NOT NULL,
  note             text,
  shop_fault       boolean NOT NULL,
  refund_method    refund_method NOT NULL,
  auto_approved    boolean NOT NULL DEFAULT false,
  label_fee        numeric(10, 2) NOT NULL DEFAULT 0 CHECK (label_fee >= 0),
  restocking_fee   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (restocking_fee >= 0),
  shipping_refund  numeric(10, 2) NOT NULL DEFAULT 0 CHECK (shipping_refund >= 0),
  refund_total     numeric(10, 2) NOT NULL DEFAULT 0 CHECK (refund_total >= 0),
  points_refund    int NOT NULL DEFAULT 0 CHECK (points_refund >= 0),
  estimate         numeric(10, 2) NOT NULL CHECK (estimate >= 0),
  label_code       text,
  label_expires_at timestamptz,
  rejected_reason  text,
  requested_at     timestamptz NOT NULL,
  decided_at       timestamptz,
  decided_by       bigint REFERENCES customers (id),
  received_at      timestamptz,
  refunded_at      timestamptz,
  updated_at       timestamptz NOT NULL
);
CREATE INDEX returns_order_idx ON returns (order_id);
CREATE INDEX returns_customer_idx ON returns (customer_id, requested_at DESC);
CREATE INDEX returns_status_idx ON returns (status, requested_at);

CREATE TABLE return_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id      bigint NOT NULL REFERENCES returns (id) ON DELETE CASCADE,
  order_item_id  bigint NOT NULL REFERENCES order_items (id),
  qty            int NOT NULL CHECK (qty > 0),
  condition      item_condition,
  refund_amount  numeric(10, 2) NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
  points_refund  int NOT NULL DEFAULT 0 CHECK (points_refund >= 0),
  restocked      boolean NOT NULL DEFAULT false,
  UNIQUE (return_id, order_item_id)
);

CREATE TABLE return_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id   bigint NOT NULL REFERENCES returns (id) ON DELETE CASCADE,
  from_status return_status,
  to_status   return_status NOT NULL,
  actor_id    bigint REFERENCES customers (id),
  note        text,
  created_at  timestamptz NOT NULL
);

-- ---------- refunds ----------

CREATE TYPE refund_kind AS ENUM ('return', 'goodwill');

-- Every refund, whatever caused it. The total refunded on an order never exceeds what was paid for it
-- (card captured plus store credit used); qa/rules.sql checks this.
CREATE TABLE refunds (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  return_id   bigint REFERENCES returns (id),
  kind        refund_kind NOT NULL,
  method      refund_method NOT NULL,
  amount      numeric(10, 2) NOT NULL CHECK (amount > 0),
  reason      text NOT NULL,
  actor_id    bigint REFERENCES customers (id),
  actor_role  staff_role,
  created_at  timestamptz NOT NULL
);
CREATE INDEX refunds_order_idx ON refunds (order_id);

ALTER TABLE store_credit_ledger ADD CONSTRAINT store_credit_refund_fk FOREIGN KEY (refund_id) REFERENCES refunds (id);
ALTER TABLE loyalty_ledger ADD CONSTRAINT loyalty_return_fk FOREIGN KEY (return_id) REFERENCES returns (id);
