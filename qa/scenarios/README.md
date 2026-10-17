# Seeder scenarios for Halden Outfitters v2

Scenarios for Propmaster's Seeder & Cleaner. Each one creates the rows a test needs, and `propmaster clean --run <id>`
removes exactly those rows afterwards.

```sh
propmaster seed --scenarios qa/scenarios                          # list them
propmaster seed --scenarios qa/scenarios confirmed-order          # seed one (prints the run id)
propmaster seed --scenarios qa/scenarios staff -p role=warehouse  # with a parameter
propmaster clean --run 42 --apply                                 # remove it when you are done
propmaster scenarios check --scenarios qa/scenarios               # CI: every scenario still seeds
```

| Scenario | Creates |
| --- | --- |
| `new-shopper` | A verified account with an address and no orders (`-p role=admin` etc. for staff) |
| `unverified-shopper` | An account whose email is not confirmed: checkout asks to verify |
| `staff` | A verified staff account (`-p role=support`, `warehouse` or `admin`) |
| `shopper-with-cart` | A shopper with 2 Test Lanterns and a Test Mug in the cart |
| `shopper-with-history` | A shopper with a delivered order (80 pending points) and a confirmed one |
| `confirmed-order` | A paid, unshipped order: card authorized, stock held (`-p status=packed`) |
| `shipped-order` | An order on its way: card charged, the hold turned into a sale |
| `delivered-order-for-return` | Delivered yesterday, return window open, returnable lines, 80 pending points |
| `order-past-return-window` | Delivered 10 January 2026 and completed: returns must be refused |
| `refunded-return` | A delivered order with 1 of 2 units returned: 43.20 back to the card, restocked, points taken back |
| `small-order` | 1 x 28.00, so it paid 7.95 domestic shipping |
| `cancelled-order` | Cancelled before shipping: card hold voided, stock hold released |
| `coupon-order` | An order with 10% off from a coupon made for it (5 uses, 1 used) |
| `shopper-with-points` | Available Halden Points (`-p points=1200`) |
| `shopper-with-store-credit` | A store-credit balance (`-p amount=60`) |
| `low-stock-product` | A product with 2 left, under its threshold of 5 (`-p stock=1`, 1 to 5) |
| `out-of-stock-product` | An active product with no stock |
| `hidden-product` | A product switched off by an admin |
| `final-sale-product` | An in-stock product that can't be returned |
| `product-with-reviews` | A product rated 4.5 from 2 published reviews by customers who received it |
| `held-review` | A review with a link, waiting for support |
| `test-coupons` | Coupons that work, need 100.00, have one use, have ended, or are switched off |

**Signing in.** Seeding writes straight to the database, so the app's password hashing doesn't run. Every seeded
account gets the same stored argon2id hash, made with the API's own `hashPassword`, for the password
**`Halden-Test-Password-1`**. It is a public test password for throwaway seeded accounts only. The seed output shows
each account's email (`...@test.halden.dev`).

**Consistent data.** Seeded rows are written the way the app writes them, so they pass every rule in `qa/rules.sql`
(checked by seeding all scenarios and running the rules over the whole database):

- Money: total = subtotal - discount - points + shipping + tax; tax is 8.00% of the goods after discounts; shipping
  matches the domestic standard rate (free from 75.00 after discounts); each line's discount and tax shares add up
  to the order's.
- Payments: the card is authorized for the total (minus store credit); `authorized` before shipping, `captured`
  for the full amount once shipped, `voided` when cancelled. The provider's own records (`haldenpay.intents`) are
  not seeded: nothing in the shop's tables points at them, and the QA lab webhook list won't show seeded orders.
- Stock: every scenario makes its own product with an opening stock movement, so on hand always equals the sum of
  its movements and the shop's real stock is untouched. Confirmed and packed orders hold stock, shipped ones have a
  sale movement and a consumed hold, cancelled ones a released hold.
- Returns, points and reviews: refunds match the return and the card, returned lines lose their pending points,
  reviews are by customers with a delivered order, and the product rating matches its published reviews.

No arithmetic runs in a scenario, so amounts are fixed: change one number and recompute the rest. Times use
Postgres' `yesterday` and `today`, so "recent" orders stay recent whenever you seed them.
