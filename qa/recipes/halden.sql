-- Test data recipes for Halden Outfitters v2, for Propmaster's Test Data Finder.
-- Find data:   propmaster find --recipes qa/recipes "never ordered" --claim
-- Check them:  propmaster recipes check --recipes qa/recipes
--
-- Each recipe is one SELECT. Parameters (:name) are declared with "-- param:" and sent as bind values.
-- "-- claim: <table>" lets testers claim a row so nobody else uses it while they test.
-- "-- seed: <scenario>" names the scenario (qa/scenarios) that creates such data: find ... --seed.
-- Status columns are Postgres enums, so they are compared as text (status::text = :status).
-- Business time: shop_now() is real time plus the QA lab's clock offset, the same clock the app uses.

-- ─── Shoppers ────────────────────────────────────────────────────────────────

-- recipe: Shopper who has never ordered
-- A verified customer account with no orders, for first-purchase, empty order history and WELCOME10 tests.
-- tags: customers, checkout, new-user
-- claim: customers
-- seed: new-shopper
SELECT c.id, c.email, c.name, c.created_at
  FROM customers c
 WHERE c.role = 'customer'
   AND c.email_verified_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
 ORDER BY c.id;

-- recipe: Shopper who has not verified their email
-- Signed up but never clicked the link: checkout must ask them to verify first.
-- tags: customers, auth, verify-email
-- claim: customers
-- seed: unverified-shopper
SELECT c.id, c.email, c.name, c.created_at
  FROM customers c
 WHERE c.role = 'customer' AND c.email_verified_at IS NULL
 ORDER BY c.id;

-- recipe: Shopper with an order history
-- A returning shopper, for the order list, order detail and reorder tests.
-- tags: customers, orders, returning
-- param: min_orders int = 2 | At least this many orders
-- claim: customers via customer_id
-- seed: shopper-with-history
SELECT c.id AS customer_id, c.email, c.name, count(o.id) AS orders, sum(o.total) AS spent, max(o.placed_at) AS last_order
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
 WHERE c.role = 'customer'
 GROUP BY c.id, c.email, c.name
HAVING count(o.id) >= :min_orders
 ORDER BY count(o.id) DESC, c.id;

-- recipe: Shopper with items in their cart
-- A signed-in shopper whose cart is not empty, for cart, merge-on-sign-in and checkout tests.
-- tags: customers, cart, checkout
-- claim: customers via customer_id
-- seed: shopper-with-cart
SELECT c.id AS customer_id, c.email, count(ci.product_id) AS lines, sum(ci.qty) AS items,
       sum(ci.qty * p.price) AS cart_value, ca.coupon_code
  FROM carts ca
  JOIN customers c ON c.id = ca.customer_id
  JOIN cart_items ci ON ci.cart_id = ca.id
  JOIN products p ON p.id = ci.product_id
 GROUP BY c.id, c.email, ca.coupon_code
 ORDER BY sum(ci.qty * p.price) DESC;

-- recipe: Shopper with Halden Points to spend
-- Available (not pending) points, for paying with points at checkout. 100 points = 5.00 off.
-- tags: customers, points, checkout
-- param: min_points int = 100 | At least this many available points
-- claim: customers via customer_id
-- seed: shopper-with-points
SELECT c.id AS customer_id, c.email, sum(l.points) AS available,
       min(l.expires_at) FILTER (WHERE l.remaining > 0) AS next_expiry
  FROM customers c
  JOIN loyalty_ledger l ON l.customer_id = c.id AND l.bucket = 'available'
 GROUP BY c.id, c.email
HAVING sum(l.points) >= :min_points
 ORDER BY sum(l.points) DESC, c.id;

-- recipe: Shopper with store credit
-- A store-credit balance, for paying with credit alone or with a card.
-- tags: customers, store-credit, checkout
-- param: min_balance numeric = 1 | At least this much credit
-- claim: customers via customer_id
-- seed: shopper-with-store-credit
SELECT c.id AS customer_id, c.email, sum(s.amount) AS balance
  FROM customers c
  JOIN store_credit_ledger s ON s.customer_id = c.id
 GROUP BY c.id, c.email
HAVING sum(s.amount) >= :min_balance
 ORDER BY sum(s.amount) DESC, c.id;

-- recipe: Locked account
-- Too many wrong passwords: sign-in is paused until locked_until.
-- tags: customers, auth, lockout
-- claim: customers
SELECT c.id, c.email, c.failed_logins, c.locked_until
  FROM customers c
 WHERE c.locked_until > shop_now()
 ORDER BY c.locked_until;

-- recipe: Staff account by role
-- A support, warehouse or admin account, for the staff console and permission tests.
-- tags: staff, roles, permissions
-- param: role text = support | support, warehouse or admin
-- claim: customers
-- seed: staff
SELECT c.id, c.email, c.name, c.role
  FROM customers c
 WHERE c.role::text = :role
 ORDER BY c.id;

-- ─── Orders ──────────────────────────────────────────────────────────────────

-- recipe: Order by status
-- One order in a given status: pending_payment, confirmed, packed, shipped, delivered, completed or cancelled.
-- tags: orders, lifecycle
-- param: status text = confirmed | The order status
-- claim: orders
-- seed: confirmed-order
SELECT o.id, o.status, o.email, o.total, o.placed_at, p.status AS payment_status
  FROM orders o
  LEFT JOIN payments p ON p.order_id = o.id
 WHERE o.status::text = :status
 ORDER BY o.placed_at DESC;

-- recipe: Order that can still be returned
-- Delivered, inside its return window (30 days from delivery; delivered 15 Nov to 31 Dec: until 31 Jan),
-- with no open return and at least one returnable unit left.
-- tags: orders, returns
-- claim: orders
-- seed: delivered-order-for-return
SELECT o.id, o.email, o.delivered_at, w.ends::date AS return_by
  FROM orders o
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN (extract(month FROM o.delivered_at AT TIME ZONE 'UTC') = 11 AND extract(day FROM o.delivered_at AT TIME ZONE 'UTC') >= 15)
               OR extract(month FROM o.delivered_at AT TIME ZONE 'UTC') = 12
             THEN greatest(date_trunc('day', o.delivered_at AT TIME ZONE 'UTC') + interval '31 days',
                           make_date(extract(year FROM o.delivered_at AT TIME ZONE 'UTC')::int + 1, 2, 1)::timestamp)
             ELSE date_trunc('day', o.delivered_at AT TIME ZONE 'UTC') + interval '31 days'
           END AT TIME ZONE 'UTC' AS ends
  ) w
 WHERE o.status = 'delivered'
   AND shop_now() < w.ends
   AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.id AND r.status IN ('requested', 'approved'))
   AND EXISTS (
     SELECT 1 FROM order_items oi
      WHERE oi.order_id = o.id AND oi.returnable
        AND oi.qty > coalesce((SELECT sum(ri.qty) FROM return_items ri JOIN returns r ON r.id = ri.return_id
                                WHERE ri.order_item_id = oi.id AND r.status NOT IN ('cancelled', 'rejected', 'expired')), 0))
 ORDER BY o.delivered_at DESC;

-- recipe: Order past its return window
-- Delivered more than 30 days ago (or completed): returns must be refused.
-- tags: orders, returns, negative
-- claim: orders
-- seed: order-past-return-window
SELECT o.id, o.email, o.status, o.delivered_at
  FROM orders o
 WHERE o.status IN ('delivered', 'completed')
   AND o.delivered_at < shop_now() - interval '31 days'
 ORDER BY o.delivered_at;

-- recipe: Order with an open return
-- A return that is requested or approved (label issued): a second return for the order must be refused.
-- tags: orders, returns
-- claim: orders via order_id
SELECT r.order_id, r.id AS return_id, r.status, r.reason, r.label_code, r.requested_at
  FROM returns r
 WHERE r.status IN ('requested', 'approved')
 ORDER BY r.requested_at DESC;

-- recipe: Return by status
-- requested, approved, rejected, received, refunded, partially_refunded, expired or cancelled.
-- tags: returns, refunds
-- param: status text = refunded | The return status
-- claim: returns
-- seed: refunded-return
SELECT r.id, r.order_id, r.status, r.reason, r.refund_method, r.refund_total, r.requested_at
  FROM returns r
 WHERE r.status::text = :status
 ORDER BY r.requested_at DESC;

-- recipe: Order paid with points or store credit
-- Part of the order was paid with Halden Points or store credit: refunds and cancels must give them back.
-- tags: orders, points, store-credit, refunds
-- claim: orders
SELECT o.id, o.status, o.total, o.points_redeemed, o.points_discount, o.store_credit_used,
       o.total - o.store_credit_used AS card_amount
  FROM orders o
 WHERE o.points_redeemed > 0 OR o.store_credit_used > 0
 ORDER BY o.placed_at DESC;

-- recipe: Order with a coupon
-- An order that used a coupon, for discount display, refund share and cancel-gives-the-use-back tests.
-- tags: orders, coupons
-- claim: orders
-- seed: coupon-order
SELECT o.id, o.status, o.coupon_code, c.kind, c.value, o.discount, o.total
  FROM orders o
  JOIN coupons c ON c.code = o.coupon_code
 ORDER BY o.placed_at DESC;

-- ─── Products ────────────────────────────────────────────────────────────────

-- recipe: Product low on stock
-- On sale with only a few left to sell (available = on hand minus stock held for orders).
-- tags: products, stock
-- claim: products via product_id
-- seed: low-stock-product
SELECT p.id AS product_id, p.slug, p.name, s.on_hand, s.reserved, s.available, p.low_stock_threshold
  FROM products p
  JOIN stock_levels s ON s.product_id = p.id
 WHERE p.active AND s.available > 0 AND s.available <= p.low_stock_threshold
 ORDER BY s.available, p.id;

-- recipe: Out-of-stock product
-- Listed but nothing left to sell: add to cart must be refused.
-- tags: products, stock, negative
-- claim: products via product_id
-- seed: out-of-stock-product
SELECT p.id AS product_id, p.slug, p.name, s.on_hand, s.reserved
  FROM products p
  JOIN stock_levels s ON s.product_id = p.id
 WHERE p.active AND s.available <= 0
 ORDER BY p.id;

-- recipe: Hidden product
-- Switched off by an admin: not listed, and its page is a 404.
-- tags: products, catalog, negative
-- claim: products
-- seed: hidden-product
SELECT p.id, p.slug, p.name
  FROM products p
 WHERE NOT p.active
 ORDER BY p.id;

-- recipe: Final-sale product
-- Not returnable (hygiene items): its lines must be refused in a return.
-- tags: products, returns, negative
-- claim: products
-- seed: final-sale-product
SELECT p.id, p.slug, p.name, p.price
  FROM products p
 WHERE p.active AND NOT p.returnable
 ORDER BY p.id;

-- recipe: Sized product
-- Reviews can say how it fits (runs small, true to size, runs large).
-- tags: products, reviews
-- claim: products
SELECT p.id, p.slug, p.name
  FROM products p
 WHERE p.active AND p.sized
 ORDER BY p.id;

-- recipe: Product with reviews
-- Published reviews and a rating, for the rating summary, sorting and helpful votes.
-- tags: products, reviews
-- param: min_reviews int = 1 | At least this many published reviews
-- claim: products
-- seed: product-with-reviews
SELECT p.id, p.slug, p.name, p.rating_avg, p.rating_count
  FROM products p
 WHERE p.active AND p.rating_count >= :min_reviews
 ORDER BY p.rating_count DESC, p.id;

-- recipe: Product without reviews
-- No published reviews yet: the page shows the empty state.
-- tags: products, reviews
-- claim: products
SELECT p.id, p.slug, p.name
  FROM products p
 WHERE p.active AND p.rating_count = 0
 ORDER BY p.id;

-- recipe: Review held for moderation
-- A review with a link, an email address or a blocked word, waiting for support to publish or hide it.
-- tags: reviews, moderation, staff
-- claim: reviews
-- seed: held-review
SELECT r.id, p.slug AS product, c.email AS author, r.rating, r.title, r.held_for, r.created_at
  FROM reviews r
  JOIN products p ON p.id = r.product_id
  JOIN customers c ON c.id = r.customer_id
 WHERE r.status = 'pending'
 ORDER BY r.created_at;

-- ─── Coupons and the QA lab ──────────────────────────────────────────────────

-- recipe: Coupon that works now
-- Active, started, not ended and with uses left.
-- tags: coupons, checkout
-- seed: test-coupons
SELECT c.code, c.kind, c.value, c.min_subtotal, c.max_uses,
       (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_code = c.code AND r.released_at IS NULL) AS uses
  FROM coupons c
 WHERE c.active
   AND (c.starts_at IS NULL OR c.starts_at <= shop_now())
   AND (c.ends_at IS NULL OR c.ends_at > shop_now())
   AND (c.max_uses IS NULL OR c.max_uses > (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_code = c.code AND r.released_at IS NULL))
 ORDER BY c.code;

-- recipe: Planted bugs switched on
-- Which QA lab bugs are on right now, and the rule in qa/rules.sql each one breaks.
-- tags: qa-lab, bugs
SELECT b.key, b.phase, b.title, b.rule
  FROM qa_bugs b
 WHERE b.enabled
 ORDER BY b.position;
