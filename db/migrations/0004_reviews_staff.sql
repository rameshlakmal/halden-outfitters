-- Phase 4: product reviews, helpful votes, the staff audit log.

-- Sized products can take a "fit" answer in reviews.
ALTER TABLE products ADD COLUMN sized boolean NOT NULL DEFAULT false;

-- ---------- reviews ----------

CREATE TYPE review_status AS ENUM ('published', 'pending', 'hidden');
CREATE TYPE review_fit AS ENUM ('runs_small', 'true_to_size', 'runs_large');

-- A product's rating_avg and rating_count are the average and count of its *published* reviews, kept up to date
-- in the same transaction as any review change; qa/rules.sql checks that they match.
CREATE TABLE reviews (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id       bigint NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  customer_id      bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 80),
  body             text NOT NULL CHECK (char_length(body) BETWEEN 20 AND 2000),
  fit              review_fit,
  status           review_status NOT NULL,
  held_for         text,          -- why a review is pending (link, email address, blocked word)
  hidden_reason    text,
  moderated_by     bigint REFERENCES customers (id),
  helpful_count    int NOT NULL DEFAULT 0 CHECK (helpful_count >= 0),
  created_at       timestamptz NOT NULL,
  edited_at        timestamptz,
  updated_at       timestamptz NOT NULL,
  UNIQUE (product_id, customer_id),
  CHECK ((status = 'hidden') = (hidden_reason IS NOT NULL))
);
CREATE INDEX reviews_product_idx ON reviews (product_id, status);
CREATE INDEX reviews_status_idx ON reviews (status, created_at);

CREATE TABLE review_votes (
  review_id    bigint NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
  customer_id  bigint NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (review_id, customer_id)
);

-- ---------- audit log ----------

-- Every staff action: who, what, on which record, the record before and after, and the request it came from.
CREATE TABLE audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id     bigint REFERENCES customers (id),
  actor_role   staff_role,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  before       jsonb,
  after        jsonb,
  request_id   text,
  created_at   timestamptz NOT NULL
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_created_idx ON audit_log (created_at DESC);
