-- Halden Outfitters v2, phase 1: accounts, sessions, catalogue, stock, carts, the email outbox, QA settings.
--
-- Constraints guard what a single row can say. Rules that span tables (stock matches its movements, a product's
-- rating matches its reviews) are the application's job, and qa/rules.sql checks them after a test.

CREATE TYPE staff_role AS ENUM ('customer', 'support', 'warehouse', 'admin');
CREATE TYPE auth_token_kind AS ENUM ('verify_email', 'reset_password');
CREATE TYPE movement_reason AS ENUM ('initial', 'sale', 'return', 'restock', 'write_off', 'adjustment');

-- ---------- accounts ----------

CREATE TABLE customers (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email              text NOT NULL CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name               text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  password_hash      text NOT NULL,
  role               staff_role NOT NULL DEFAULT 'customer',
  email_verified_at  timestamptz,
  failed_logins      int NOT NULL DEFAULT 0 CHECK (failed_logins >= 0),
  locked_until       timestamptz,
  -- Seeded demo accounts: their emails never show in the public fake inbox, so nobody can reset their passwords.
  is_demo            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customers_email_key ON customers (email);

-- A session is a random token in a cookie; only its SHA-256 is stored, so a database leak can't be replayed.
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  user_agent    text,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_customer_idx ON sessions (customer_id) WHERE revoked_at IS NULL;

-- Single-use links sent by email (verify the address, reset the password). Stored hashed, like sessions.
CREATE TABLE auth_tokens (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  kind         auth_token_kind NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_tokens_customer_idx ON auth_tokens (customer_id, kind);

CREATE TABLE countries (
  code  char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name  text NOT NULL UNIQUE
);

CREATE TABLE addresses (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id   bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  label         text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 30),
  name          text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  line1         text NOT NULL CHECK (length(trim(line1)) BETWEEN 1 AND 120),
  line2         text CHECK (line2 IS NULL OR length(line2) <= 120),
  city          text NOT NULL CHECK (length(trim(city)) BETWEEN 1 AND 80),
  region        text CHECK (region IS NULL OR length(region) <= 80),
  postcode      text NOT NULL CHECK (length(trim(postcode)) BETWEEN 2 AND 12),
  country_code  char(2) NOT NULL REFERENCES countries (code),
  phone         text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{6,20}$'),
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_customer_idx ON addresses (customer_id);
CREATE UNIQUE INDEX addresses_one_default ON addresses (customer_id) WHERE is_default;

-- ---------- catalogue ----------

CREATE TABLE categories (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug      text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name      text NOT NULL,
  blurb     text NOT NULL,
  image     text NOT NULL,
  position  int NOT NULL
);

CREATE TABLE products (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  sku                  text NOT NULL UNIQUE CHECK (sku ~ '^HO-[A-Z0-9]{3,12}$'),
  category_id          int NOT NULL REFERENCES categories (id),
  name                 text NOT NULL,
  summary              text NOT NULL,
  description          text NOT NULL,
  details              jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(details) = 'array'),  -- [[label, value], ...]
  price                numeric(10, 2) NOT NULL CHECK (price > 0),
  compare_at_price     numeric(10, 2) CHECK (compare_at_price IS NULL OR compare_at_price > price),  -- set = on sale
  returnable           boolean NOT NULL DEFAULT true,
  featured             boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  low_stock_threshold  int NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  rating_avg           numeric(2, 1) CHECK (rating_avg BETWEEN 1 AND 5),
  rating_count         int NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  version              int NOT NULL DEFAULT 1,  -- optimistic locking for staff edits
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((rating_count = 0) = (rating_avg IS NULL))
);
CREATE INDEX products_category_idx ON products (category_id) WHERE active;
CREATE INDEX products_search_idx ON products USING gin (to_tsvector('english', name || ' ' || summary));

CREATE TABLE product_images (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt         text NOT NULL CHECK (length(trim(alt)) > 0),
  width       int NOT NULL CHECK (width > 0),
  height      int NOT NULL CHECK (height > 0),
  position    int NOT NULL,
  UNIQUE (product_id, position)
);

-- Stock physically on hand. Every change also writes stock_movements, so stock always reconciles.
-- (Reservations for open orders arrive with checkout in phase 2: available = on_hand - reserved.)
CREATE TABLE inventory (
  product_id  bigint PRIMARY KEY REFERENCES products (id) ON DELETE CASCADE,
  on_hand     int NOT NULL CHECK (on_hand >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  change      int NOT NULL CHECK (change <> 0),
  reason      movement_reason NOT NULL,
  order_id    bigint,
  note        text,
  actor_id    bigint REFERENCES customers (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id);

-- The one place that says how much can be sold. Phase 2 replaces `reserved` with open-order reservations.
CREATE VIEW stock_levels AS
SELECT i.product_id, i.on_hand, 0 AS reserved, i.on_hand AS available
  FROM inventory i;

-- ---------- carts ----------

-- A cart belongs to a browser (cookie) until its owner signs in; then it's merged into the customer's cart.
CREATE TABLE carts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  bigint REFERENCES customers (id) ON DELETE CASCADE,
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

-- ---------- platform ----------

-- Emails are written here in the same transaction as the change that sends them. The fake inbox reads them.
CREATE TABLE outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email    text NOT NULL,
  template    text NOT NULL,
  subject     text NOT NULL,
  body_text   text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbox_to_idx ON outbox (to_email, created_at DESC);

-- Fixed-window rate limits shared by every serverless instance.
CREATE TABLE rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  hits          int NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- QA lab settings, e.g. the shop clock offset used to test time-based rules.
CREATE TABLE qa_settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);
INSERT INTO qa_settings (key, value) VALUES ('clock_offset_seconds', '0');
