import type { Queryable } from '../../core/db.js';
import { CARD_FROM, CARD_SELECT, type CardRow } from '../catalog/repository.js';

export type LineRow = CardRow & { qty: number; active: boolean };

export const cartRepo = {
  async findByCustomer(db: Queryable, customerId: string): Promise<string | null> {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM carts WHERE customer_id = $1', [customerId]);
    return rows[0]?.id ?? null;
  },

  async findGuest(db: Queryable, id: string): Promise<string | null> {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM carts WHERE id = $1 AND customer_id IS NULL', [id]);
    return rows[0]?.id ?? null;
  },

  /** The customer's cart, created if they have none. Safe when two requests race to create it. */
  async ensureForCustomer(db: Queryable, customerId: string): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO carts (customer_id) VALUES ($1)
       ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL DO UPDATE SET updated_at = now()
       RETURNING id`,
      [customerId],
    );
    return rows[0]!.id;
  },

  async createGuest(db: Queryable): Promise<string> {
    const { rows } = await db.query<{ id: string }>('INSERT INTO carts DEFAULT VALUES RETURNING id');
    return rows[0]!.id;
  },

  /** Every line with the product as it is now (price, stock, still sold or not). Inactive products are kept. */
  async lines(db: Queryable, cartId: string): Promise<LineRow[]> {
    const { rows } = await db.query<LineRow>(
      `SELECT ${CARD_SELECT()}, ci.qty, p.active ${CARD_FROM}
         JOIN cart_items ci ON ci.product_id = p.id
        WHERE ci.cart_id = $1
        ORDER BY ci.added_at, p.id`,
      [cartId],
    );
    return rows;
  },

  async product(db: Queryable, productId: string) {
    const { rows } = await db.query<{ active: boolean; available: number; name: string }>(
      'SELECT p.active, p.name, sl.available FROM products p JOIN stock_levels sl ON sl.product_id = p.id WHERE p.id = $1',
      [productId],
    );
    return rows[0];
  },

  async lineQty(db: Queryable, cartId: string, productId: string): Promise<number> {
    const { rows } = await db.query<{ qty: number }>(
      'SELECT qty FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cartId, productId],
    );
    return rows[0]?.qty ?? 0;
  },

  async setQty(db: Queryable, cartId: string, productId: string, qty: number): Promise<void> {
    await db.query(
      `INSERT INTO cart_items (cart_id, product_id, qty) VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id) DO UPDATE SET qty = excluded.qty`,
      [cartId, productId, qty],
    );
    await db.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
  },

  async removeLine(db: Queryable, cartId: string, productId: string): Promise<number> {
    const r = await db.query('DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2', [cartId, productId]);
    await db.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
    return r.rowCount ?? 0;
  },

  async clear(db: Queryable, cartId: string): Promise<void> {
    await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
    await db.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
  },
};
