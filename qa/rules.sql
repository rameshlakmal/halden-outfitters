-- Business rules for Halden Outfitters, for Propmaster:
--   propmaster record check qa/rules.sql        (the latest session)
--   propmaster record check qa/rules.sql 12     (session 12)
-- Each rule is a query that returns the rows breaking it; no rows means the rule holds.
-- {{orders}} means "the orders this test session touched"; Propmaster fills it in.
-- Each planted bug in the admin's QA lab breaks at least one rule (named in brackets).

-- rule: Order total is subtotal minus discount plus shipping and tax
SELECT o.id, o.subtotal, o.discount, o.shipping, o.tax, o.total
  FROM {{orders}} o
 WHERE o.total <> o.subtotal - o.discount + o.shipping + o.tax;

-- rule: Order subtotal matches its lines  [price edits rewrite past orders]
SELECT o.id, o.subtotal, sum(oi.line_total) AS lines_total
  FROM {{orders}} o
  JOIN order_items oi ON oi.order_id = o.id
 GROUP BY o.id, o.subtotal
HAVING o.subtotal <> sum(oi.line_total);

-- rule: Each order line is unit price times quantity
SELECT oi.order_id, oi.product_id, oi.unit_price, oi.qty, oi.line_total
  FROM {{order_items}} oi
 WHERE oi.line_total <> oi.unit_price * oi.qty;

-- rule: Shipping is free from 75.00 after discount, otherwise 7.95
SELECT o.id, o.subtotal - o.discount AS after_discount, o.shipping
  FROM {{orders}} o
 WHERE o.shipping <> CASE WHEN o.subtotal - o.discount >= 75 THEN 0 ELSE 7.95 END;

-- rule: Tax is 8% of the discounted subtotal, rounded to the cent
SELECT o.id, o.subtotal - o.discount AS taxable, o.tax, round((o.subtotal - o.discount) * 0.08, 2) AS expected
  FROM {{orders}} o
 WHERE o.tax <> round((o.subtotal - o.discount) * 0.08, 2);

-- rule: The discount is exactly what the coupon gives  [coupon applied twice]
SELECT o.id, o.coupon_code, o.discount,
       least(o.subtotal, CASE c.kind WHEN 'percent' THEN round(o.subtotal * c.value / 100, 2) ELSE c.value END) AS expected
  FROM {{orders}} o
  JOIN coupons c ON c.code = o.coupon_code
 WHERE o.discount <> least(o.subtotal, CASE c.kind WHEN 'percent' THEN round(o.subtotal * c.value / 100, 2) ELSE c.value END);

-- rule: No discount without a coupon
SELECT o.id, o.discount
  FROM {{orders}} o
 WHERE o.coupon_code IS NULL AND o.discount <> 0;

-- rule: The card is charged the order total  [payment misses shipping]
SELECT o.id, o.total, p.amount
  FROM {{orders}} o
  JOIN payments p ON p.order_id = o.id
 WHERE p.amount <> o.total;

-- rule: Every order has exactly one payment
SELECT o.id, count(p.id) AS payments
  FROM {{orders}} o
  LEFT JOIN payments p ON p.order_id = o.id
 GROUP BY o.id
HAVING count(p.id) <> 1;

-- rule: Cancelled orders are refunded, and only cancelled orders
SELECT o.id, o.status, p.status AS payment_status
  FROM {{orders}} o
  JOIN payments p ON p.order_id = o.id
 WHERE (o.status = 'cancelled') <> (p.status = 'refunded');

-- rule: A cancelled order returns its items to stock  [cancelling keeps the stock]
SELECT o.id, oi.product_id, oi.qty AS ordered,
       coalesce((SELECT sum(m.change) FROM stock_movements m
                  WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.reason = 'cancel'), 0) AS returned
  FROM {{orders}} o
  JOIN order_items oi ON oi.order_id = o.id
 WHERE o.status = 'cancelled'
   AND oi.qty <> coalesce((SELECT sum(m.change) FROM stock_movements m
                            WHERE m.order_id = o.id AND m.product_id = oi.product_id AND m.reason = 'cancel'), 0);

-- rule: Every sale took its items out of stock
SELECT oi.order_id, oi.product_id, oi.qty,
       coalesce((SELECT -sum(m.change) FROM stock_movements m
                  WHERE m.order_id = oi.order_id AND m.product_id = oi.product_id AND m.reason = 'sale'), 0) AS taken
  FROM {{order_items}} oi
 WHERE oi.qty <> coalesce((SELECT -sum(m.change) FROM stock_movements m
                            WHERE m.order_id = oi.order_id AND m.product_id = oi.product_id AND m.reason = 'sale'), 0);

-- rule: Stock on hand matches the stock movements
SELECT i.product_id, i.stock, coalesce(sum(m.change), 0) AS movements
  FROM {{inventory}} i
  LEFT JOIN stock_movements m ON m.product_id = i.product_id
 GROUP BY i.product_id, i.stock
HAVING i.stock <> coalesce(sum(m.change), 0);

-- rule: A coupon is never used more often than allowed  [coupon use limit ignored]
SELECT c.code, c.max_uses, c.used_count
  FROM {{coupons}} c
 WHERE c.max_uses IS NOT NULL AND c.used_count > c.max_uses;

-- rule: A coupon's use count matches the orders that used it
SELECT c.code, c.used_count, count(o.id) AS orders
  FROM {{coupons}} c
  LEFT JOIN orders o ON o.coupon_code = c.code
 GROUP BY c.code, c.used_count
HAVING c.used_count <> count(o.id);
