-- Phase 2: shipping zones and rates, coupons v2, stock reservations, orders, payments (HaldenPay mock),
-- webhooks, idempotency keys, planted bugs.

-- ---------- shop time ----------

-- Business time in SQL: real time plus the QA lab's clock offset, so views and rules that run in the database
-- agree with the application's shop clock.
CREATE FUNCTION shop_now() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT now() + make_interval(secs => coalesce((SELECT (value #>> '{}')::int FROM qa_settings WHERE key = 'clock_offset_seconds'), 0))
$$;

-- ---------- shipping and tax ----------

CREATE TYPE shipping_method AS ENUM ('standard', 'express');

CREATE TABLE shipping_zones (
  code      text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  name      text NOT NULL,
  position  int NOT NULL
);

ALTER TABLE countries ADD COLUMN zone_code text REFERENCES shipping_zones (code);

CREATE TABLE shipping_rates (
  zone_code  text NOT NULL REFERENCES shipping_zones (code),
  method     shipping_method NOT NULL,
  price      numeric(10, 2) NOT NULL CHECK (price >= 0),
  free_from  numeric(10, 2) CHECK (free_from IS NULL OR free_from > 0),  -- order subtotal after discounts
  days_min   int NOT NULL CHECK (days_min > 0),
  days_max   int NOT NULL CHECK (days_max >= days_min),
  PRIMARY KEY (zone_code, method)
);

-- Shop-wide settings that staff can change (the tax rate). Orders copy what they were charged.
CREATE TABLE shop_settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);
INSERT INTO shop_settings (key, value) VALUES ('tax_rate_percent', '8');

-- ---------- coupons ----------

CREATE TYPE coupon_kind AS ENUM ('percent', 'fixed', 'free_shipping');

CREATE TABLE coupons (
  code                text PRIMARY KEY CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{3,20}$'),
  kind                coupon_kind NOT NULL,
  value               numeric(10, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
  min_subtotal        numeric(10, 2) NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_uses            int CHECK (max_uses > 0),             -- NULL: unlimited
  per_customer_limit  int CHECK (per_customer_limit > 0),   -- NULL: unlimited
  first_order_only    boolean NOT NULL DEFAULT false,
  excludes_sale_items boolean NOT NULL DEFAULT true,
  starts_at           timestamptz,
  ends_at             timestamptz,
  active              boolean NOT NULL DEFAULT true,
  description         text NOT NULL DEFAULT '',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR (value > 0 AND value <= 100)),
  CHECK (kind <> 'fixed' OR value > 0),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE coupon_excluded_categories (
  coupon_code  text NOT NULL REFERENCES coupons (code) ON DELETE CASCADE,
  category_id  int NOT NULL REFERENCES categories (id),
  PRIMARY KEY (coupon_code, category_id)
);

ALTER TABLE carts ADD COLUMN coupon_code text REFERENCES coupons (code);

-- ---------- orders ----------

CREATE TYPE order_status AS ENUM ('pending_payment', 'confirmed', 'packed', 'shipped', 'delivered', 'completed', 'cancelled');
CREATE TYPE cancel_reason AS ENUM (
  'changed_mind', 'ordered_by_mistake', 'found_cheaper', 'delivery_too_slow', 'other',
  'payment_failed', 'payment_timeout', 'out_of_stock', 'fraud_suspected', 'customer_request');

CREATE TABLE orders (
  id                  bigint GENERATED ALWAYS AS IDENTITY (START WITH 100001) PRIMARY KEY,
  customer_id         bigint NOT NULL REFERENCES customers (id),
  email               text NOT NULL,
  status              order_status NOT NULL,
  subtotal            numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  discount            numeric(10, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  shipping            numeric(10, 2) NOT NULL CHECK (shipping >= 0),
  tax                 numeric(10, 2) NOT NULL CHECK (tax >= 0),
  total               numeric(10, 2) NOT NULL CHECK (total >= 0),
  tax_rate            numeric(5, 2) NOT NULL CHECK (tax_rate >= 0),
  coupon_code         text REFERENCES coupons (code),
  shipping_zone       text NOT NULL REFERENCES shipping_zones (code),
  shipping_method     shipping_method NOT NULL,
  ship_name           text NOT NULL,
  ship_line1          text NOT NULL,
  ship_line2          text,
  ship_city           text NOT NULL,
  ship_region         text,
  ship_postcode       text NOT NULL,
  ship_country        char(2) NOT NULL REFERENCES countries (code),
  ship_phone          text,
  payment_expires_at  timestamptz,                -- pending_payment orders are cancelled after this
  placed_at           timestamptz NOT NULL,
  confirmed_at        timestamptz,
  packed_at           timestamptz,
  shipped_at          timestamptz,
  delivered_at        timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       cancel_reason,
  cancel_note         text,
  tracking_number     text,
  version             int NOT NULL DEFAULT 1,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL),
  CHECK (status <> 'pending_payment' OR payment_expires_at IS NOT NULL)
);
CREATE INDEX orders_customer_idx ON orders (customer_id, placed_at DESC);
CREATE INDEX orders_status_idx ON orders (status, placed_at);

-- Lines copy what was sold at the time (name, price, returnability), and each line's share of the order's
-- discount and tax, so a later refund for part of the order is exact.
CREATE TABLE order_items (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id        bigint NOT NULL REFERENCES products (id),
  sku               text NOT NULL,
  name              text NOT NULL,
  image             text NOT NULL,
  category_id       int NOT NULL REFERENCES categories (id),
  unit_price        numeric(10, 2) NOT NULL CHECK (unit_price > 0),
  qty               int NOT NULL CHECK (qty > 0),
  line_total        numeric(10, 2) NOT NULL CHECK (line_total > 0),
  discount_alloc    numeric(10, 2) NOT NULL DEFAULT 0 CHECK (discount_alloc >= 0),
  tax_alloc         numeric(10, 2) NOT NULL DEFAULT 0 CHECK (tax_alloc >= 0),
  returnable        boolean NOT NULL,
  on_sale           boolean NOT NULL DEFAULT false,
  UNIQUE (order_id, product_id),
  CHECK (discount_alloc <= line_total)
);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE order_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  from_status  order_status,
  to_status    order_status NOT NULL,
  actor_id     bigint REFERENCES customers (id),        -- NULL: the system
  actor_role   staff_role,
  note         text,
  created_at   timestamptz NOT NULL
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

-- Who used which coupon on which order. A cancelled order releases its redemption.
CREATE TABLE coupon_redemptions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  coupon_code  text NOT NULL REFERENCES coupons (code),
  customer_id  bigint NOT NULL REFERENCES customers (id),
  order_id     bigint NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL,
  released_at  timestamptz
);
CREATE INDEX coupon_redemptions_coupon_idx ON coupon_redemptions (coupon_code) WHERE released_at IS NULL;

-- ---------- stock reservations ----------

-- Stock held for an open order. A pending_payment hold expires; a confirmed order's hold lasts until it ships
-- (consumed: the stock leaves on_hand) or is cancelled (released).
CREATE TABLE stock_reservations (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id   bigint NOT NULL REFERENCES products (id),
  qty          int NOT NULL CHECK (qty > 0),
  expires_at   timestamptz,
  released_at  timestamptz,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL,
  UNIQUE (order_id, product_id),
  CHECK (released_at IS NULL OR consumed_at IS NULL)
);
CREATE INDEX stock_reservations_open_idx ON stock_reservations (product_id) WHERE released_at IS NULL AND consumed_at IS NULL;

-- Available to sell = on hand minus holds that are still open and not expired (by the shop clock).
CREATE OR REPLACE VIEW stock_levels AS
SELECT i.product_id,
       i.on_hand,
       coalesce(r.reserved, 0)::int AS reserved,
       (i.on_hand - coalesce(r.reserved, 0))::int AS available
  FROM inventory i
  LEFT JOIN (
    SELECT product_id, sum(qty) AS reserved
      FROM stock_reservations
     WHERE released_at IS NULL AND consumed_at IS NULL AND (expires_at IS NULL OR expires_at > shop_now())
     GROUP BY product_id
  ) r ON r.product_id = i.product_id;

-- ---------- payments (HaldenPay) ----------

CREATE TYPE payment_status AS ENUM (
  'requires_action', 'authorized', 'captured', 'voided', 'failed', 'partially_refunded', 'refunded');

CREATE TABLE payments (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id          bigint NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  provider          text NOT NULL DEFAULT 'haldenpay',
  intent_id         text NOT NULL UNIQUE,
  status            payment_status NOT NULL,
  amount            numeric(10, 2) NOT NULL CHECK (amount > 0),        -- authorized amount
  amount_captured   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (amount_captured >= 0),
  amount_refunded   numeric(10, 2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  card_brand        text NOT NULL,
  card_last4        text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  failure_code      text,
  disputed          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL,
  updated_at        timestamptz NOT NULL,
  CHECK (amount_captured <= amount),
  CHECK (amount_refunded <= amount_captured)
);

-- The mock provider's own records, in its own schema: as far as the shop is concerned this is a third party
-- reached through the gateway interface and its signed webhooks.
CREATE SCHEMA haldenpay;

CREATE TABLE haldenpay.intents (
  id              text PRIMARY KEY,
  merchant_ref    text NOT NULL,                 -- our order id
  amount          numeric(10, 2) NOT NULL,
  captured        numeric(10, 2) NOT NULL DEFAULT 0,
  refunded        numeric(10, 2) NOT NULL DEFAULT 0,
  status          text NOT NULL,
  card_last4      text NOT NULL,
  card_brand      text NOT NULL,
  scenario        text NOT NULL,                 -- which test card behaviour applies
  action_token    text UNIQUE,                   -- for the "bank" step
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Events the provider will deliver to the shop's webhook endpoint (signed). Delivery can be repeated.
CREATE TABLE haldenpay.events (
  id            text PRIMARY KEY,
  intent_id     text NOT NULL REFERENCES haldenpay.intents (id),
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  deliver_after timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  attempts      int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Webhook events the shop has processed: a repeat delivery of the same event id is ignored.
CREATE TABLE webhook_events (
  id            text PRIMARY KEY,
  provider      text NOT NULL,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- idempotency ----------

-- The same Idempotency-Key with the same body returns the first response; with a different body it's refused.
CREATE TABLE idempotency_keys (
  customer_id     bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  route           text NOT NULL,
  request_hash    text NOT NULL,
  status_code     int,                -- NULL while the first request is still running
  response        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, key)
);

-- ---------- QA lab: planted bugs ----------

CREATE TABLE qa_bugs (
  key          text PRIMARY KEY,
  phase        int NOT NULL,
  title        text NOT NULL,
  description  text NOT NULL,
  how_to_see   text NOT NULL,
  rule         text NOT NULL,          -- the qa/rules.sql rule it breaks
  enabled      boolean NOT NULL DEFAULT false,
  position     int NOT NULL
);
