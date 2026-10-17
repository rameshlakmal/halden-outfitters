-- Business rules for Halden Outfitters v2, for Propmaster:
--   propmaster record check qa/rules.sql             (the latest session)
--   propmaster record check qa/rules.sql 12          (session 12)
--   propmaster record check qa/rules.sql --all-rows  (the whole database)
-- Each rule is a query that returns the rows breaking it; no rows means the rule holds.
-- {{orders}} means "the orders this test session touched"; Propmaster fills it in.
-- A rule tagged [bug_key] is the one that planted bug breaks (QA lab). The API's test suite switches each bug
-- on in turn and checks that it breaks its own rule and no other (apps/api/test/rules.test.ts).

-- ============================================================================================================
-- Order money
-- ============================================================================================================

-- rule: Order total is subtotal minus discounts plus shipping and tax
SELECT o.id, o.subtotal, o.discount, o.points_discount, o.shipping, o.tax, o.total
  FROM {{orders}} o
 WHERE o.total <> o.subtotal - o.discount - o.points_discount + o.shipping + o.tax;

-- rule: An order subtotal is the sum of its lines  [price_edit_rewrites_orders]
SELECT o.id, o.subtotal, sum(oi.line_total) AS lines_total
  FROM {{orders}} o
  JOIN order_items oi ON oi.order_id = o.id
 GROUP BY o.id, o.subtotal
HAVING o.subtotal <> sum(oi.line_total);

-- rule: Each order line is unit price times quantity
SELECT oi.order_id, oi.product_id, oi.unit_price, oi.qty, oi.line_total
  FROM {{order_items}} oi
 WHERE oi.line_total <> oi.unit_price * oi.qty;

-- rule: Line shares add up to the order's discount, points discount and tax
SELECT o.id, o.discount, sum(oi.discount_alloc) AS discount_shares, o.points_discount, sum(oi.points_alloc) AS points_shares,
       o.tax, sum(oi.tax_alloc) AS tax_shares
  FROM {{orders}} o
  JOIN order_items oi ON oi.order_id = o.id
 GROUP BY o.id
HAVING o.discount <> sum(oi.discount_alloc) OR o.points_discount <> sum(oi.points_alloc) OR o.tax <> sum(oi.tax_alloc);

-- rule: Tax is the order's tax rate on goods after discounts, rounded to the cent
SELECT o.id, o.tax_rate, o.subtotal - o.discount - o.points_discount AS taxable, o.tax,
       round((o.subtotal - o.discount - o.points_discount) * o.tax_rate / 100, 2) AS expected
  FROM {{orders}} o
 WHERE o.tax <> round((o.subtotal - o.discount - o.points_discount) * o.tax_rate / 100, 2);

-- rule: Shipping matches the zone rate  [eu_domestic_rate]
SELECT o.id, o.shipping_zone, o.shipping_method, o.shipping, r.price, r.free_from
  FROM {{orders}} o
  JOIN shipping_rates r ON r.zone_code = o.shipping_zone AND r.method = o.shipping_method
  LEFT JOIN coupons c ON c.code = o.coupon_code
 WHERE o.shipping <> CASE
         WHEN c.kind = 'free_shipping' THEN 0
         WHEN r.free_from IS NOT NULL AND o.subtotal - o.discount - o.points_discount >= r.free_from THEN 0
         ELSE r.price
       END;

-- rule: The discount is exactly what the coupon gives  [coupon_twice]
WITH eligible AS (
  SELECT o.id, c.kind, c.value,
         coalesce(sum(oi.line_total) FILTER (
           WHERE NOT (oi.on_sale AND c.excludes_sale_items)
             AND oi.category_id NOT IN (SELECT category_id FROM coupon_excluded_categories x WHERE x.coupon_code = c.code)
         ), 0) AS amount
    FROM {{orders}} o
    JOIN coupons c ON c.code = o.coupon_code
    JOIN order_items oi ON oi.order_id = o.id
   GROUP BY o.id, c.code, c.kind, c.value
)
SELECT o.id, o.coupon_code, o.discount, e.amount AS eligible,
       CASE e.kind WHEN 'percent' THEN round(e.amount * e.value / 100, 2) WHEN 'fixed' THEN least(e.value, e.amount) ELSE 0 END AS expected
  FROM {{orders}} o
  JOIN eligible e ON e.id = o.id
 WHERE o.discount <> CASE e.kind WHEN 'percent' THEN round(e.amount * e.value / 100, 2) WHEN 'fixed' THEN least(e.value, e.amount) ELSE 0 END;

-- rule: No coupon discount without a coupon
SELECT o.id, o.discount
  FROM {{orders}} o
 WHERE o.coupon_code IS NULL AND o.discount <> 0;

-- rule: Points pay 5.00 per 100 and at most half the subtotal after the coupon
SELECT o.id, o.points_redeemed, o.points_discount, o.subtotal - o.discount AS after_coupon
  FROM {{orders}} o
 WHERE o.points_discount <> o.points_redeemed / 100 * 5
    OR o.points_discount > (o.subtotal - o.discount) / 2;

-- ============================================================================================================
-- Payments
-- ============================================================================================================

-- rule: The card is authorized for what the order leaves to pay  [payment_misses_shipping]
SELECT o.id, o.total, o.store_credit_used, p.amount
  FROM {{orders}} o
  JOIN payments p ON p.order_id = o.id
 WHERE p.amount <> o.total - o.store_credit_used;

-- rule: An order has a card payment exactly when something is left to pay by card
SELECT o.id, o.total, o.store_credit_used, count(p.id) AS payments
  FROM {{orders}} o
  LEFT JOIN payments p ON p.order_id = o.id
 GROUP BY o.id
HAVING count(p.id) <> CASE WHEN o.total > o.store_credit_used THEN 1 ELSE 0 END;

-- rule: Cancelled orders have no open authorization  [cancel_leaves_authorization]
SELECT o.id, o.status, p.status AS payment_status
  FROM {{orders}} o
  JOIN payments p ON p.order_id = o.id
 WHERE o.status = 'cancelled' AND p.status IN ('authorized', 'requires_action', 'captured');

-- rule: Shipped orders are charged the authorized amount
SELECT o.id, o.status, p.status AS payment_status, p.amount, p.amount_captured
  FROM {{orders}} o
  JOIN payments p ON p.order_id = o.id
 WHERE o.status IN ('shipped', 'delivered', 'completed')
   AND (p.status NOT IN ('captured', 'partially_refunded', 'refunded') OR p.amount_captured <> p.amount);

-- rule: Nothing is charged before an order ships
SELECT o.id, o.status, p.amount_captured
  FROM {{orders}} o
  JOIN payments p ON p.order_id = o.id
 WHERE o.status IN ('pending_payment', 'confirmed', 'packed', 'cancelled') AND p.amount_captured <> 0;

-- ============================================================================================================
-- Coupons
-- ============================================================================================================

-- rule: A coupon is never used more often than allowed  [coupon_limit_ignored]
SELECT c.code, c.max_uses, count(*) AS uses
  FROM coupons c
  JOIN coupon_redemptions r ON r.coupon_code = c.code AND r.released_at IS NULL
 WHERE c.max_uses IS NOT NULL
   AND c.code IN (SELECT coupon_code FROM {{orders}} WHERE coupon_code IS NOT NULL)
 GROUP BY c.code, c.max_uses
HAVING count(*) > c.max_uses;

-- rule: A customer never uses a coupon more often than allowed  [coupon_customer_limit_ignored]
SELECT c.code, r.customer_id, c.per_customer_limit, count(*) AS uses
  FROM coupons c
  JOIN coupon_redemptions r ON r.coupon_code = c.code AND r.released_at IS NULL
 WHERE c.per_customer_limit IS NOT NULL
   AND (c.code, r.customer_id) IN (SELECT coupon_code, customer_id FROM {{orders}} WHERE coupon_code IS NOT NULL)
 GROUP BY c.code, r.customer_id, c.per_customer_limit
HAVING count(*) > c.per_customer_limit;

-- rule: Cancelled orders hold no coupon use  [cancel_keeps_coupon_use]
SELECT o.id, o.coupon_code
  FROM {{orders}} o
  JOIN coupon_redemptions r ON r.order_id = o.id AND r.released_at IS NULL
 WHERE o.status = 'cancelled';

-- ============================================================================================================
-- Stock
-- ============================================================================================================

-- rule: Open stock holds belong to open orders  [cancel_keeps_reservation]
SELECT o.id, o.status, s.product_id, s.qty
  FROM {{orders}} o
  JOIN stock_reservations s ON s.order_id = o.id AND s.released_at IS NULL AND s.consumed_at IS NULL
 WHERE o.status NOT IN ('pending_payment', 'confirmed', 'packed');

-- rule: Stock on hand is the sum of its movements
SELECT i.product_id, i.on_hand, coalesce(sum(m.change), 0) AS movements
  FROM {{inventory}} i
  LEFT JOIN stock_movements m ON m.product_id = i.product_id
 GROUP BY i.product_id, i.on_hand
HAVING i.on_hand <> coalesce(sum(m.change), 0);

-- rule: Stock held for orders never exceeds stock on hand
SELECT s.product_id, s.on_hand, s.reserved
  FROM stock_levels s
 WHERE s.product_id IN (SELECT product_id FROM {{inventory}})
   AND s.reserved > s.on_hand;

-- rule: Written-off returns are never restocked  [restock_damaged]
SELECT ri.return_id, ri.order_item_id, ri.condition
  FROM {{return_items}} ri
 WHERE ri.restocked AND ri.condition IN ('damaged_by_customer', 'faulty');

-- ============================================================================================================
-- Returns and refunds
-- ============================================================================================================

-- rule: Returns are requested within 30 days of delivery  [return_window_restarts]
SELECT r.id, r.order_id, o.delivered_at, r.requested_at
  FROM {{returns}} r
  JOIN orders o ON o.id = r.order_id
 WHERE o.delivered_at IS NULL
    OR r.requested_at >= CASE
         -- Holiday rule: delivered from 15 November to 31 December, returnable until 31 January.
         WHEN (extract(month FROM o.delivered_at AT TIME ZONE 'UTC') = 11 AND extract(day FROM o.delivered_at AT TIME ZONE 'UTC') >= 15)
           OR extract(month FROM o.delivered_at AT TIME ZONE 'UTC') = 12
         THEN greatest(date_trunc('day', o.delivered_at AT TIME ZONE 'UTC') + interval '31 days',
                       make_date(extract(year FROM o.delivered_at AT TIME ZONE 'UTC')::int + 1, 2, 1)::timestamp)
         ELSE date_trunc('day', o.delivered_at AT TIME ZONE 'UTC') + interval '31 days'
       END AT TIME ZONE 'UTC';

-- rule: Units returned never exceed units ordered
SELECT oi.order_id, oi.product_id, oi.qty, sum(ri.qty) AS returned
  FROM {{order_items}} oi
  JOIN return_items ri ON ri.order_item_id = oi.id
  JOIN returns r ON r.id = ri.return_id AND r.status NOT IN ('cancelled', 'rejected', 'expired')
 GROUP BY oi.id
HAVING sum(ri.qty) > oi.qty;

-- rule: A line is never refunded more than was paid for it  [refund_ignores_discount]
SELECT oi.order_id, oi.product_id, oi.line_total - oi.discount_alloc - oi.points_alloc + oi.tax_alloc AS paid,
       sum(ri.refund_amount) AS refunded
  FROM {{order_items}} oi
  JOIN return_items ri ON ri.order_item_id = oi.id
 GROUP BY oi.id
HAVING sum(ri.refund_amount) > oi.line_total - oi.discount_alloc - oi.points_alloc + oi.tax_alloc;

-- rule: A return's refund adds up from its lines and fees
SELECT r.id, r.refund_total, sum(ri.refund_amount) AS lines, r.label_fee, r.shipping_refund
  FROM {{returns}} r
  JOIN return_items ri ON ri.return_id = r.id
 WHERE r.status IN ('refunded', 'partially_refunded')
 GROUP BY r.id
HAVING r.refund_total <> sum(ri.refund_amount) - r.label_fee + r.shipping_refund;

-- rule: A refunded return has its refund recorded once
SELECT r.id, r.refund_total, coalesce(sum(f.amount), 0) AS refunded
  FROM {{returns}} r
  LEFT JOIN refunds f ON f.return_id = r.id
 WHERE r.status IN ('refunded', 'partially_refunded')
 GROUP BY r.id
HAVING r.refund_total <> coalesce(sum(f.amount), 0);

-- rule: Refunds never exceed what was paid  [refund_over_captured]
SELECT o.id, o.store_credit_used + coalesce(p.amount_captured, 0) AS paid, sum(f.amount) AS refunded
  FROM {{orders}} o
  LEFT JOIN payments p ON p.order_id = o.id
  JOIN refunds f ON f.order_id = o.id
 GROUP BY o.id, o.store_credit_used, p.amount_captured
HAVING sum(f.amount) > o.store_credit_used + coalesce(p.amount_captured, 0);

-- rule: Each refund is paid out once  [store_credit_double]
SELECT o.id, sum_refunds.amount AS refunds, coalesce(p.amount_refunded, 0) AS to_card, coalesce(credit.amount, 0) AS to_credit
  FROM {{orders}} o
  JOIN (SELECT order_id, sum(amount) AS amount FROM refunds GROUP BY order_id) sum_refunds ON sum_refunds.order_id = o.id
  LEFT JOIN payments p ON p.order_id = o.id
  LEFT JOIN (SELECT order_id, sum(amount) AS amount FROM store_credit_ledger WHERE reason IN ('refund', 'goodwill') GROUP BY order_id) credit
         ON credit.order_id = o.id
 WHERE coalesce(p.amount_refunded, 0) + coalesce(credit.amount, 0) <> sum_refunds.amount;

-- rule: Support goodwill refunds stay within 50.00 per order  [support_goodwill_unlimited]
SELECT f.order_id, sum(f.amount) AS goodwill_by_support
  FROM {{refunds}} f
 WHERE f.kind = 'goodwill' AND f.actor_role = 'support'
 GROUP BY f.order_id
HAVING sum(f.amount) > 50;

-- ============================================================================================================
-- Halden Points and store credit
-- ============================================================================================================

-- rule: Points are earned on goods only  [points_on_tax_shipping]
SELECT o.id, o.points_earned, o.subtotal - o.discount - o.points_discount AS goods
  FROM {{orders}} o
 WHERE o.points_earned > 0
   AND o.points_earned NOT IN (floor(o.subtotal - o.discount - o.points_discount), floor((o.subtotal - o.discount - o.points_discount) * 1.5));

-- rule: Points are earned only by delivered orders
SELECT o.id, o.status, o.points_earned
  FROM {{orders}} o
 WHERE o.points_earned > 0 AND o.status NOT IN ('delivered', 'completed');

-- rule: Returned lines hold no points  [returned_keeps_points]
SELECT r.id, r.order_id
  FROM {{returns}} r
 WHERE r.status IN ('refunded', 'partially_refunded')
   AND EXISTS (SELECT 1 FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
                WHERE ri.return_id = r.id AND oi.points_earned > 0)
   AND NOT EXISTS (SELECT 1 FROM loyalty_ledger l WHERE l.return_id = r.id AND l.kind = 'return_reversal');

-- rule: Nobody has a negative points balance
SELECT l.customer_id, l.bucket, sum(l.points) AS balance
  FROM loyalty_ledger l
 WHERE l.customer_id IN (SELECT customer_id FROM {{loyalty_ledger}})
 GROUP BY l.customer_id, l.bucket
HAVING sum(l.points) < 0;

-- rule: Unspent points match the available balance
SELECT l.customer_id, sum(l.points) AS available, sum(l.remaining) FILTER (WHERE l.remaining > 0) AS unspent
  FROM loyalty_ledger l
 WHERE l.bucket = 'available' AND l.customer_id IN (SELECT customer_id FROM {{loyalty_ledger}})
 GROUP BY l.customer_id
HAVING sum(l.points) <> coalesce(sum(l.remaining) FILTER (WHERE l.remaining > 0), 0);

-- rule: Nobody has a negative store credit balance
SELECT s.customer_id, sum(s.amount) AS balance
  FROM store_credit_ledger s
 WHERE s.customer_id IN (SELECT customer_id FROM {{store_credit_ledger}})
 GROUP BY s.customer_id
HAVING sum(s.amount) < 0;

-- ============================================================================================================
-- Reviews
-- ============================================================================================================

-- rule: A product rating is the average of its published reviews  [hidden_reviews_counted]
SELECT p.id, p.slug, p.rating_avg, p.rating_count, round(avg(r.rating) FILTER (WHERE r.status = 'published'), 1) AS expected_avg,
       count(r.id) FILTER (WHERE r.status = 'published') AS expected_count
  FROM products p
  LEFT JOIN reviews r ON r.product_id = p.id
 WHERE p.id IN (SELECT product_id FROM {{reviews}})
 GROUP BY p.id
HAVING p.rating_count <> count(r.id) FILTER (WHERE r.status = 'published')
    OR p.rating_avg IS DISTINCT FROM round(avg(r.rating) FILTER (WHERE r.status = 'published'), 1);

-- rule: Reviews are written by customers who received the product
SELECT r.id, r.customer_id, r.product_id
  FROM {{reviews}} r
 WHERE NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                    WHERE o.customer_id = r.customer_id AND oi.product_id = r.product_id
                      AND o.delivered_at IS NOT NULL AND o.delivered_at <= r.created_at);

-- rule: A review's helpful count matches its votes
SELECT r.id, r.helpful_count, count(v.customer_id) AS votes
  FROM {{reviews}} r
  LEFT JOIN review_votes v ON v.review_id = r.id
 GROUP BY r.id
HAVING r.helpful_count <> count(v.customer_id);
