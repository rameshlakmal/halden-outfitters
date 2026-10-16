// Cart rules:
//   - A line holds 1 to 20 of a product, and never more than is available to sell right now.
//   - Only products that are still sold can be added. Lines whose product stopped selling, sold out or dropped
//     below the line's quantity stay in the cart, flagged with a problem, and block checkout until fixed.
//   - Signed out, the cart belongs to the browser (cookie). On sign-in it is merged into the customer's cart:
//     quantities are added, capped at 20 and at what's available; the browser cart is then deleted.
import { type Cart, type CartLine, MAX_LINE_QTY } from '@halden/contracts';
import { fromCents, toCents } from '@halden/money';
import type { Db, Queryable } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { toCard } from '../catalog/repository.js';
import { cartRepo, type LineRow } from './repository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Who the cart belongs to in this request. */
export type CartOwner = { customerId: string | null; guestCartId: string | undefined };

export function toCart(rows: LineRow[]): Cart {
  const lines: CartLine[] = rows.map((r) => {
    const card = toCard(r);
    const problem: CartLine['problem'] = !r.active
      ? 'unavailable'
      : r.available <= 0
        ? 'out_of_stock'
        : r.available < r.qty
          ? 'not_enough_stock'
          : null;
    return {
      productId: r.id,
      slug: r.slug,
      name: r.name,
      image: card.image,
      unitPrice: r.price,
      compareAtPrice: r.compare_at_price,
      qty: r.qty,
      lineTotal: fromCents(toCents(r.price) * r.qty),
      availability: card.availability,
      problem,
    };
  });
  const subtotal = lines.reduce((n, l) => n + toCents(l.lineTotal), 0);
  const savings = lines.reduce(
    (n, l) => n + (l.compareAtPrice ? (toCents(l.compareAtPrice) - toCents(l.unitPrice)) * l.qty : 0),
    0,
  );
  return {
    lines,
    itemCount: lines.reduce((n, l) => n + l.qty, 0),
    subtotal: fromCents(subtotal),
    savings: fromCents(savings),
    canCheckOut: lines.length > 0 && lines.every((l) => l.problem === null),
  };
}

const EMPTY: Cart = { lines: [], itemCount: 0, subtotal: '0.00', savings: '0.00', canCheckOut: false };

export class CartService {
  constructor(private readonly db: Db) {}

  /** The cart id for this owner, or null when there is none yet. */
  async find(owner: CartOwner, client: Queryable = this.db.pool): Promise<string | null> {
    if (owner.customerId) return cartRepo.findByCustomer(client, owner.customerId);
    if (owner.guestCartId && UUID.test(owner.guestCartId)) return cartRepo.findGuest(client, owner.guestCartId);
    return null;
  }

  async view(owner: CartOwner): Promise<Cart> {
    const id = await this.find(owner);
    return id ? toCart(await cartRepo.lines(this.db.pool, id)) : EMPTY;
  }

  /**
   * Adds `qty` of a product. Returns the cart and, for a new browser cart, its id (for the cookie).
   * Locks the cart row, so two quick clicks add up instead of overwriting each other.
   */
  async add(owner: CartOwner, productId: string, qty: number): Promise<{ cart: Cart; newGuestCartId: string | null }> {
    return this.db.tx(async (tx) => {
      const product = await cartRepo.product(tx, productId);
      if (!product || !product.active) throw new AppError('product_unavailable', 'That product is not available.');
      if (product.available <= 0) throw new AppError('out_of_stock', `Sorry, ${product.name} is out of stock.`);

      let id = await this.find(owner, tx);
      let newGuestCartId: string | null = null;
      if (!id) {
        id = owner.customerId ? await cartRepo.ensureForCustomer(tx, owner.customerId) : await cartRepo.createGuest(tx);
        if (!owner.customerId) newGuestCartId = id;
      }
      await tx.query('SELECT 1 FROM carts WHERE id = $1 FOR UPDATE', [id]);

      const current = await cartRepo.lineQty(tx, id, productId);
      const wanted = current + qty;
      if (wanted > MAX_LINE_QTY) {
        throw new AppError('validation_failed', `You can buy up to ${MAX_LINE_QTY} of one product per order.`, {
          errors: [{ path: 'qty', message: `At most ${MAX_LINE_QTY} per product.` }],
        });
      }
      if (wanted > product.available) {
        throw new AppError(
          'not_enough_stock',
          current > 0
            ? `Only ${product.available} ${product.name} left, and ${current} are already in your cart.`
            : `Only ${product.available} ${product.name} left.`,
        );
      }
      await cartRepo.setQty(tx, id, productId, wanted);
      return { cart: toCart(await cartRepo.lines(tx, id)), newGuestCartId };
    });
  }

  async setQty(owner: CartOwner, productId: string, qty: number): Promise<Cart> {
    return this.db.tx(async (tx) => {
      const id = await this.find(owner, tx);
      if (!id || (await cartRepo.lineQty(tx, id, productId)) === 0) {
        throw new AppError('not_found', 'That product is not in your cart.');
      }
      const product = await cartRepo.product(tx, productId);
      if (!product || !product.active) throw new AppError('product_unavailable', 'That product is no longer sold. Remove it from your cart.');
      if (qty > product.available) {
        throw new AppError(
          product.available === 0 ? 'out_of_stock' : 'not_enough_stock',
          product.available === 0 ? `Sorry, ${product.name} is out of stock.` : `Only ${product.available} ${product.name} left.`,
        );
      }
      await cartRepo.setQty(tx, id, productId, qty);
      return toCart(await cartRepo.lines(tx, id));
    });
  }

  async remove(owner: CartOwner, productId: string): Promise<Cart> {
    const id = await this.find(owner);
    if (!id || (await cartRepo.removeLine(this.db.pool, id, productId)) === 0) {
      throw new AppError('not_found', 'That product is not in your cart.');
    }
    return toCart(await cartRepo.lines(this.db.pool, id));
  }

  async clear(owner: CartOwner): Promise<Cart> {
    const id = await this.find(owner);
    if (id) await cartRepo.clear(this.db.pool, id);
    return EMPTY;
  }

  /** On sign-in: moves a browser cart into the customer's cart. Runs inside the sign-in transaction. */
  async mergeGuestCart(tx: Queryable, customerId: string, guestCartId: string | undefined): Promise<void> {
    if (!guestCartId || !UUID.test(guestCartId)) return;
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM carts WHERE id = $1 AND customer_id IS NULL FOR UPDATE', [
      guestCartId,
    ]);
    if (!rows[0]) return;
    const own = await cartRepo.ensureForCustomer(tx, customerId);
    await tx.query(
      `INSERT INTO cart_items (cart_id, product_id, qty, added_at)
       SELECT $2, g.product_id, least(g.qty, $3, greatest(sl.available, 1)), g.added_at
         FROM cart_items g
         JOIN stock_levels sl ON sl.product_id = g.product_id
        WHERE g.cart_id = $1
       ON CONFLICT (cart_id, product_id) DO UPDATE
         SET qty = least(cart_items.qty + excluded.qty, $3,
                         greatest((SELECT available FROM stock_levels WHERE product_id = excluded.product_id), cart_items.qty))`,
      [guestCartId, own, MAX_LINE_QTY],
    );
    await tx.query('DELETE FROM carts WHERE id = $1', [guestCartId]);
  }
}
