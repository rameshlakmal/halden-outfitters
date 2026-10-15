-- Test data recipes for Halden Outfitters, for Propmaster's Test Data Finder.
-- Find data:   propmaster find --recipes qa/recipes "never ordered" --claim
-- Check them:  propmaster recipes check --recipes qa/recipes
--
-- Each recipe is one SELECT. Parameters (:name) are declared with "-- param:" and sent as bind values.
-- "-- claim: <table>" lets testers claim a row so nobody else uses it while they test.
-- "-- seed: <scenario>" names the scenario (qa/scenarios) that creates such data: find ... --seed.
-- Status columns are Postgres enums, so they are compared as text (status::text = :status).

-- ─── Shoppers ────────────────────────────────────────────────────────────────

-- recipe: Shopper who has never ordered
-- A brand-new account, for first-purchase, empty order history and WELCOME10 tests.
-- tags: customers, checkout, new-user
-- claim: customers
-- seed: new-shopper
SELECT c.id, c.email, c.name, c.created_at
  FROM customers c
 WHERE NOT c.is_admin
   AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
 ORDER BY c.id;

-- recipe: Shopper with an order history
-- A returning shopper, for the My orders page and reorder tests.
-- tags: customers, orders, returning
-- param: min_orders int = 2 | At least this many orders
-- claim: customers via customer_id
-- seed: shopper-with-history
SELECT c.id AS customer_id, c.email, c.name, count(o.id) AS orders, sum(o.total) AS spent, max(o.created_at) AS last_order
  FROM customers c
  JOIN orders o ON o.customer_id = c.id
 WHERE NOT c.is_admin
 GROUP BY c.id, c.email, c.name
HAVING count(o.id) >= :min_orders
 ORDER BY count(o.id) DESC, c.id;

-- recipe: Shopper with items in their cart
-- A signed-in shopper whose cart is not empty, for cart, merge-on-login and checkout tests.
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

-- recipe: Admin account
-- For admin pages: products, orders and the QA lab. Sign in with the password from TEST-ACCOUNTS.md.
-- tags: customers, admin
-- claim: customers
SELECT c.id, c.email, c.name
  FROM customers c
 WHERE c.is_admin
 ORDER BY c.id;

-- ─── Orders ──────────────────────────────────────────────────────────────────

-- recipe: Order in a given status
-- tags: orders
-- param: status text = paid | paid, shipped, delivered or cancelled
-- claim: orders
SELECT o.id, o.status, o.total, c.email AS customer, o.created_at
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
 WHERE o.status::text = :status
 ORDER BY o.created_at DESC;

-- recipe: Paid order that can still be cancelled
-- Paid but not shipped, with its payment captured: for cancel, refund and stock-return tests.
-- tags: orders, cancel, refund, payments, inventory
-- claim: orders
-- seed: paid-order
SELECT o.id, o.total, p.amount AS paid, p.card_last4, c.email AS customer, o.created_at
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN payments p ON p.order_id = o.id
 WHERE o.status = 'paid' AND p.status = 'captured'
 ORDER BY o.created_at DESC;

-- recipe: Cancelled and refunded order
-- For refund display, order history and "cancelled orders are refunded" checks.
-- tags: orders, cancel, refund, payments
-- claim: orders
-- seed: cancelled-order
SELECT o.id, o.total, p.amount AS refunded, p.status AS payment, c.email AS customer, o.updated_at
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  JOIN payments p ON p.order_id = o.id
 WHERE o.status = 'cancelled' AND p.status = 'refunded'
 ORDER BY o.updated_at DESC;

-- recipe: Order that used a coupon
-- For order summaries that show a discount, and coupon reporting.
-- tags: orders, coupons, discount
-- param: code text = '' | A coupon code such as WELCOME10, or empty for any coupon
-- claim: orders
-- seed: coupon-order
SELECT o.id, o.coupon_code, o.subtotal, o.discount, o.total, o.status, c.email AS customer
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
 WHERE o.coupon_code IS NOT NULL
   AND (:code = '' OR o.coupon_code = upper(:code))
 ORDER BY o.created_at DESC;

-- recipe: Order with a shipping charge
-- Under 75.00 after discount, so it paid 7.95 shipping: for shipping-threshold tests.
-- tags: orders, shipping
-- claim: orders
-- seed: small-order
SELECT o.id, o.subtotal - o.discount AS after_discount, o.shipping, o.total, c.email AS customer
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
 WHERE o.shipping > 0
 ORDER BY o.created_at DESC;

-- recipe: Order with several different products
-- For order detail pages, partial stock and line-total tests.
-- tags: orders, order-items
-- param: min_lines int = 2 | At least this many different products
-- claim: orders via order_id
SELECT o.id AS order_id, count(oi.id) AS lines, sum(oi.qty) AS items, o.total, o.status, c.email AS customer
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN customers c ON c.id = o.customer_id
 GROUP BY o.id, o.total, o.status, c.email
HAVING count(oi.id) >= :min_lines
 ORDER BY count(oi.id) DESC, o.id DESC;

-- recipe: Order bought at an old price
-- A line whose price differs from the product's price today. The order must keep the price paid
-- (the "price edits rewrite past orders" planted bug breaks this).
-- tags: orders, products, price, regression
-- claim: orders via order_id
SELECT oi.order_id, oi.product_id, oi.name, oi.unit_price AS paid_price, p.price AS price_now
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
 WHERE oi.unit_price <> p.price
 ORDER BY oi.order_id DESC;

-- ─── Products and stock ──────────────────────────────────────────────────────

-- recipe: Product in stock
-- An active product you can add to the cart.
-- tags: products, inventory, cart
-- param: category text = '' | shelter, sleep, kitchen, carry… or empty for any
-- param: min_stock int = 5 | At least this many in stock
-- claim: products
SELECT p.id, p.slug, p.name, p.price, i.stock, cat.slug AS category
  FROM products p
  JOIN inventory i ON i.product_id = p.id
  JOIN categories cat ON cat.id = p.category_id
 WHERE p.active
   AND i.stock >= :min_stock
   AND (:category = '' OR cat.slug = :category)
 ORDER BY i.stock DESC;

-- recipe: Low-stock product
-- Only a few left: for "only N left" badges, qty limits and overselling tests.
-- tags: products, inventory, stock, boundary
-- param: max_stock int = 5 | At most this many in stock
-- claim: products
-- seed: low-stock-product
SELECT p.id, p.slug, p.name, p.price, i.stock
  FROM products p
  JOIN inventory i ON i.product_id = p.id
 WHERE p.active AND i.stock BETWEEN 1 AND :max_stock
 ORDER BY i.stock, p.id;

-- recipe: Out-of-stock product
-- Active but with no stock: the product page should block "Add to cart".
-- tags: products, inventory, stock, negative
-- claim: products
-- seed: out-of-stock-product
SELECT p.id, p.slug, p.name, p.price
  FROM products p
  JOIN inventory i ON i.product_id = p.id
 WHERE p.active AND i.stock = 0
 ORDER BY p.id;

-- recipe: Hidden product
-- Not active: it must not show in the shop or search, and a direct link should not sell it.
-- tags: products, negative, admin
-- claim: products
-- seed: hidden-product
SELECT p.id, p.slug, p.name, p.price
  FROM products p
 WHERE NOT p.active
 ORDER BY p.id;

-- recipe: Product never sold
-- No order lines yet: safe to edit, deactivate or reprice in admin tests.
-- tags: products, admin
-- claim: products
SELECT p.id, p.slug, p.name, p.price, i.stock
  FROM products p
  JOIN inventory i ON i.product_id = p.id
 WHERE NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = p.id)
 ORDER BY p.id;

-- recipe: Product whose stock doesn't add up
-- Stock on hand differs from the sum of its stock movements: a sign of a stock bug, not test data.
-- tags: products, inventory, stock, integrity
SELECT p.id, p.name, i.stock, coalesce(sum(m.change), 0) AS from_movements
  FROM products p
  JOIN inventory i ON i.product_id = p.id
  LEFT JOIN stock_movements m ON m.product_id = p.id
 GROUP BY p.id, p.name, i.stock
HAVING i.stock <> coalesce(sum(m.change), 0)
 ORDER BY p.id;

-- ─── Coupons ─────────────────────────────────────────────────────────────────

-- recipe: Coupon that works
-- Active, not expired and with uses left: for discount tests.
-- tags: coupons, discount, checkout
-- param: kind text = '' | percent, fixed, or empty for either
-- claim: coupons
-- seed: test-coupons
SELECT c.code, c.kind, c.value, c.min_subtotal,
       CASE WHEN c.max_uses IS NULL THEN 'unlimited' ELSE (c.max_uses - c.used_count)::text END AS uses_left
  FROM coupons c
 WHERE c.active
   AND (c.expires_at IS NULL OR c.expires_at > now())
   AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
   AND (:kind = '' OR c.kind::text = :kind)
 ORDER BY c.min_subtotal, c.code;

-- recipe: Coupon with a minimum spend
-- Works only above a subtotal: test just below and just above min_subtotal.
-- tags: coupons, discount, boundary
-- claim: coupons
-- seed: test-coupons
SELECT c.code, c.kind, c.value, c.min_subtotal,
       c.min_subtotal - 0.01 AS try_rejected_at, c.min_subtotal AS try_accepted_at
  FROM coupons c
 WHERE c.active AND c.min_subtotal > 0
   AND (c.expires_at IS NULL OR c.expires_at > now())
   AND (c.max_uses IS NULL OR c.used_count < c.max_uses)
 ORDER BY c.min_subtotal;

-- recipe: Coupon that should be refused
-- Inactive, expired or used up: checkout must reject it with a clear message.
-- tags: coupons, negative
-- claim: coupons
-- seed: test-coupons
SELECT c.code, c.kind, c.value,
       CASE WHEN NOT c.active THEN 'inactive'
            WHEN c.expires_at <= now() THEN 'expired'
            ELSE 'used up' END AS why
  FROM coupons c
 WHERE NOT c.active
    OR c.expires_at <= now()
    OR c.used_count >= c.max_uses
 ORDER BY c.code;
