# Seeder scenarios for Halden Outfitters

Scenarios for Propmaster's Seeder & Cleaner. Each one creates the rows a test needs, and `propmaster clean --run <id>`
removes exactly those rows afterwards.

```sh
propmaster seed --scenarios qa/scenarios                    # list them
propmaster seed --scenarios qa/scenarios paid-order         # seed one (prints the run id)
propmaster clean --run 42 --apply                           # remove it when you are done
propmaster scenarios check --scenarios qa/scenarios         # CI: every scenario still seeds
```

| Scenario | Creates |
| --- | --- |
| `new-shopper` | A shopper with no orders (`-p admin=true` for an admin) |
| `shopper-with-cart` | A shopper with a Trail Tarp and Camp Pillows in the cart |
| `shopper-with-history` | A shopper with a delivered order and a paid one |
| `paid-order` | A paid, unshipped order (`-p status=shipped` or `delivered`) |
| `small-order` | A paid order under 75.00, so it paid 7.95 shipping |
| `cancelled-order` | A cancelled order, refunded and returned to stock |
| `coupon-order` | A paid order with a 10% discount from its own coupon |
| `low-stock-product` | A product with 2 left (`-p stock=1`) |
| `out-of-stock-product` | An active product with no stock |
| `hidden-product` | A product switched off in admin |
| `test-coupons` | Working, minimum-spend, single-use, expired and inactive coupons |

**Signing in.** Seeding writes straight to the database, so the app's password hashing doesn't run. Every seeded
shopper gets the same stored hash, for the password **`Halden-Test-1`**. The seed output shows each shopper's e-mail.

**Consistent data.** Orders are seeded the way checkout writes them, so they pass `qa/rules.sql`:
total = subtotal - discount + shipping + 8% tax, shipping is free from 75.00, the payment matches the total, and
every sale or cancellation has its stock movement. Orders use a product created by the same scenario, so the shop's
real stock is never thrown out of balance, and a coupon an order uses is created with it, so its use count matches.
No arithmetic runs in a scenario, so order amounts are fixed: change one number and recompute the rest.
