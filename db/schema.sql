-- Halden Outfitters: the shop's database.
--
-- Constraints guard what a single row can say (a price is positive, a quantity is at least 1, an email is
-- unique). Rules that span tables (an order's total matches its lines, a payment matches its order, stock
-- matches its movements) are the application's job, which is exactly where real bugs hide. qa/rules.sql
-- checks those rules after a test, with Propmaster.
--
-- Running this file drops and recreates every shop table. Recorder data (Propmaster's _propmaster schema)
-- is left alone.

BEGIN;

DROP TABLE IF EXISTS qa_bugs, payments, order_events, order_items, orders, stock_movements, cart_items, carts,
  coupons, inventory, products, categories, customers CASCADE;
DROP TYPE IF EXISTS order_status, payment_status, movement_reason, coupon_kind CASCADE;

CREATE TYPE order_status AS ENUM ('paid', 'shipped', 'delivered', 'cancelled');
CREATE TYPE payment_status AS ENUM ('captured', 'refunded');
CREATE TYPE movement_reason AS ENUM ('initial', 'sale', 'cancel', 'restock', 'adjustment');
CREATE TYPE coupon_kind AS ENUM ('percent', 'fixed');

CREATE TABLE customers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  name          text NOT NULL CHECK (length(trim(name)) > 0),
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_email_key ON customers (email);

CREATE TABLE categories (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      text NOT NULL UNIQUE,
  name      text NOT NULL,
  blurb     text NOT NULL,
  position  int NOT NULL
);

CREATE TABLE products (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id  int NOT NULL REFERENCES categories (id),
  name         text NOT NULL,
  summary      text NOT NULL,
  description  text NOT NULL,
  details      jsonb NOT NULL DEFAULT '[]',          -- [[label, value], ...]: an array, because jsonb objects don't keep key order
  price        numeric(10, 2) NOT NULL CHECK (price > 0),
  image        text NOT NULL,
  featured     boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products (category_id) WHERE active;

-- Stock on hand. Every change is also written to stock_movements, so stock can always be reconciled.
CREATE TABLE inventory (
  product_id  bigint PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
  stock       int NOT NULL CHECK (stock >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  change      int NOT NULL CHECK (change <> 0),
  reason      movement_reason NOT NULL,
  order_id    bigint,                               -- for sales and cancellations
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id);
CREATE INDEX stock_movements_order_idx ON stock_movements (order_id) WHERE order_id IS NOT NULL;

CREATE TABLE coupons (
  code          text PRIMARY KEY CHECK (code = upper(code) AND code ~ '^[A-Z0-9]{3,20}$'),
  kind          coupon_kind NOT NULL,
  value         numeric(10, 2) NOT NULL CHECK (value > 0),
  min_subtotal  numeric(10, 2) NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_uses      int CHECK (max_uses > 0),           -- NULL: unlimited
  used_count    int NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  active        boolean NOT NULL DEFAULT true,
  expires_at    timestamptz,
  CHECK (kind <> 'percent' OR value <= 100)
);

-- A cart belongs to a browser (cookie) and, once signed in, to a customer.
CREATE TABLE carts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  bigint REFERENCES customers (id) ON DELETE CASCADE,
  coupon_code  text REFERENCES coupons (code),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carts_customer_key ON carts (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE cart_items (
  cart_id     uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  qty         int NOT NULL CHECK (qty BETWEEN 1 AND 20),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE orders (
  id             bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) PRIMARY KEY,
  customer_id    bigint NOT NULL REFERENCES customers (id),
  status         order_status NOT NULL DEFAULT 'paid',
  subtotal       numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  discount       numeric(10, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  shipping       numeric(10, 2) NOT NULL CHECK (shipping >= 0),
  tax            numeric(10, 2) NOT NULL CHECK (tax >= 0),
  total          numeric(10, 2) NOT NULL CHECK (total >= 0),
  coupon_code    text REFERENCES coupons (code),
  ship_name      text NOT NULL,
  ship_line1     text NOT NULL,
  ship_city      text NOT NULL,
  ship_postcode  text NOT NULL,
  ship_country   text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON orders (customer_id, created_at DESC);

-- Name and price are copied at checkout: an order shows what was bought, at the price paid.
CREATE TABLE order_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id  bigint NOT NULL REFERENCES products (id),
  name        text NOT NULL,
  unit_price  numeric(10, 2) NOT NULL CHECK (unit_price > 0),
  qty         int NOT NULL CHECK (qty > 0),
  line_total  numeric(10, 2) NOT NULL CHECK (line_total > 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_product_idx ON order_items (product_id);

CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  status      order_status NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id);

CREATE TABLE payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  amount      numeric(10, 2) NOT NULL CHECK (amount > 0),
  method      text NOT NULL DEFAULT 'card',
  card_last4  text NOT NULL CHECK (card_last4 ~ '^[0-9]{4}$'),
  status      payment_status NOT NULL DEFAULT 'captured',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_order_key ON payments (order_id);

-- Planted bugs for QA practice. Off by default; switched on from the admin's QA lab.
CREATE TABLE qa_bugs (
  key          text PRIMARY KEY,
  title        text NOT NULL,
  description  text NOT NULL,
  how_to_see   text NOT NULL,
  enabled      boolean NOT NULL DEFAULT false,
  position     int NOT NULL
);

COMMIT;
