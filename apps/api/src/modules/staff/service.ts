// Staff console back office (DESIGN.md 3.10): products and stock, coupons, shipping rates and tax, customers and
// roles, the audit log. Every change is audited in the same transaction.
//
// Product edits use optimistic locking: the client sends back the version it loaded (If-Match). If someone else
// saved in between, the save is refused with 412 and the current version, so nobody overwrites a change unseen.
import type { Role, StaffProduct } from '@halden/contracts';
import { toCents } from '@halden/money';
import { audit, diff } from '../../core/audit.js';
import type { CurrentUser } from '../../core/auth.js';
import type { AppContext } from '../../core/context.js';
import type { Queryable } from '../../core/db.js';
import { AppError, fieldError, notFound } from '../../core/errors.js';
import { queueEmail } from '../../core/outbox.js';

type ProductRow = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  summary: string;
  description: string;
  category_slug: string;
  category_name: string;
  image: string | null;
  price: string;
  compare_at_price: string | null;
  active: boolean;
  featured: boolean;
  returnable: boolean;
  sized: boolean;
  low_stock_threshold: number;
  on_hand: number;
  reserved: number;
  available: number;
  rating_avg: string | null;
  rating_count: number;
  version: number;
  updated_at: Date;
};

const PRODUCT_SELECT = `
  SELECT p.id, p.slug, p.sku, p.name, p.summary, p.description, c.slug AS category_slug, c.name AS category_name,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image,
         p.price, p.compare_at_price, p.active, p.featured, p.returnable, p.sized, p.low_stock_threshold,
         sl.on_hand, sl.reserved, sl.available, p.rating_avg, p.rating_count, p.version, p.updated_at
    FROM products p JOIN categories c ON c.id = p.category_id JOIN stock_levels sl ON sl.product_id = p.id`;

const toStaffProduct = (r: ProductRow): StaffProduct => ({
  id: r.id,
  slug: r.slug,
  sku: r.sku,
  name: r.name,
  summary: r.summary,
  description: r.description,
  category: { slug: r.category_slug, name: r.category_name },
  image: r.image ?? '',
  price: r.price,
  compareAtPrice: r.compare_at_price,
  active: r.active,
  featured: r.featured,
  returnable: r.returnable,
  sized: r.sized,
  stock: { onHand: r.on_hand, reserved: r.reserved, available: r.available, lowStockThreshold: r.low_stock_threshold },
  rating: { average: r.rating_avg === null ? null : Number(r.rating_avg), count: r.rating_count },
  version: r.version,
  updatedAt: r.updated_at.toISOString(),
});

export type ProductEdit = Partial<{
  name: string;
  summary: string;
  description: string;
  price: string;
  compareAtPrice: string | null;
  active: boolean;
  featured: boolean;
  returnable: boolean;
  lowStockThreshold: number;
}>;

const COLUMNS: Record<keyof ProductEdit, string> = {
  name: 'name',
  summary: 'summary',
  description: 'description',
  price: 'price',
  compareAtPrice: 'compare_at_price',
  active: 'active',
  featured: 'featured',
  returnable: 'returnable',
  lowStockThreshold: 'low_stock_threshold',
};

/** Parses an If-Match header: `"3"`, `W/"3"` or `3`. */
export function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const m = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  return m ? Number(m[1]) : NaN;
}

export class StaffService {
  constructor(private readonly ctx: AppContext) {}

  // ---------- products ----------

  async products(q: { q?: string; lowStock?: boolean }, cursor: string | null, limit: number) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
    }
    if (q.lowStock) where.push('sl.available <= p.low_stock_threshold');
    if (cursor) {
      params.push(cursor);
      where.push(`p.id > $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await this.ctx.db.query<ProductRow>(
      `${PRODUCT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.id LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    return { items: page.map(toStaffProduct), nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null };
  }

  async product(id: string, db: Queryable = this.ctx.db.pool): Promise<StaffProduct> {
    const { rows } = await db.query<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1`, [id]);
    if (!rows[0]) throw notFound('That product');
    return toStaffProduct(rows[0]);
  }

  async editProduct(id: string, user: CurrentUser, ifMatch: number | null, edit: ProductEdit, now: Date) {
    if (ifMatch === null) throw new AppError('precondition_required', 'Send If-Match with the version you loaded, so a newer save is not overwritten.');
    if (Number.isNaN(ifMatch)) throw new AppError('precondition_required', 'If-Match must be the version number, like "3".');
    await this.ctx.db.tx(async (tx) => {
      const { rows } = await tx.query<{ version: number; price: string; compare_at_price: string | null } & Record<string, unknown>>(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE',
        [id],
      );
      const p = rows[0];
      if (!p) throw notFound('That product');
      if (p.version !== ifMatch) {
        throw new AppError('precondition_failed', `Someone else saved this product (now version ${p.version}). Reload it and make your change again.`);
      }
      const price = edit.price ?? p.price;
      const compare = edit.compareAtPrice === undefined ? p.compare_at_price : edit.compareAtPrice;
      if (compare !== null && toCents(compare) <= toCents(price)) throw fieldError('compareAtPrice', 'The old price must be above the price.');

      const current = Object.fromEntries(Object.entries(COLUMNS).map(([k, col]) => [k, p[col]]));
      const changes = diff(current, edit);
      if (!changes.changed) return;
      const keys = Object.keys(changes.after) as (keyof ProductEdit)[];
      await tx.query(
        `UPDATE products SET ${keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`).join(', ')}, version = version + 1, updated_at = $${keys.length + 2}
          WHERE id = $1`,
        [id, ...keys.map((k) => changes.after[k]), now],
      );
      // Planted bug: price_edit_rewrites_orders. Orders keep the price they were placed at; this rewrites them.
      if (edit.price && edit.price !== p.price && (await this.ctx.bugs.enabled('price_edit_rewrites_orders', tx))) {
        await tx.query('UPDATE order_items SET unit_price = $2::numeric, line_total = $2::numeric * qty WHERE product_id = $1', [id, edit.price]);
      }
      await audit(tx, user, 'product.update', { type: 'product', id }, { before: changes.before, after: changes.after }, now);
    });
    return this.product(id);
  }

  /** Stock arriving, counted or written off. Stock held for orders can't be adjusted away. */
  async adjustStock(id: string, user: CurrentUser, input: { change: number; reason: 'restock' | 'adjustment' | 'write_off'; note?: string }, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const { rows } = await tx.query<{ on_hand: number; name: string; sku: string; low_stock_threshold: number }>(
        `SELECT i.on_hand, p.name, p.sku, p.low_stock_threshold FROM inventory i JOIN products p ON p.id = i.product_id
          WHERE i.product_id = $1 FOR UPDATE OF i`,
        [id],
      );
      const row = rows[0];
      if (!row) throw notFound('That product');
      if (input.reason === 'restock' && input.change < 0) throw fieldError('change', 'A restock adds stock.');
      if (input.reason === 'write_off' && input.change > 0) throw fieldError('change', 'A write-off removes stock.');
      const { rows: lv } = await tx.query<{ reserved: number }>('SELECT reserved FROM stock_levels WHERE product_id = $1', [id]);
      const reserved = lv[0]?.reserved ?? 0;
      const free = row.on_hand - reserved;
      if (input.change < 0 && -input.change > free) {
        throw fieldError('change', `Only ${free} can be removed: ${reserved} are held for orders.`, `Only ${free} units are not held for orders.`);
      }
      await tx.query('UPDATE inventory SET on_hand = on_hand + $2, updated_at = $3 WHERE product_id = $1', [id, input.change, now]);
      await tx.query(
        'INSERT INTO stock_movements (product_id, change, reason, actor_id, note, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, input.change, input.reason, user.id, input.note ?? null, now],
      );
      await audit(tx, user, `stock.${input.reason}`, { type: 'product', id }, { before: { onHand: row.on_hand }, after: { onHand: row.on_hand + input.change } }, now);
      await lowStockCheck(this.ctx, tx, id, now);
    });
    return this.product(id);
  }

  async movements(id: string, limit = 50) {
    const rows = await this.ctx.db.query<{ change: number; reason: string; order_id: string | null; note: string | null; by: string | null; created_at: Date }>(
      `SELECT m.change, m.reason, m.order_id, m.note, c.name AS by, m.created_at
         FROM stock_movements m LEFT JOIN customers c ON c.id = m.actor_id
        WHERE m.product_id = $1 ORDER BY m.id DESC LIMIT $2`,
      [id, limit],
    );
    return rows.map((r) => ({ change: r.change, reason: r.reason, orderId: r.order_id, note: r.note, by: r.by, at: r.created_at.toISOString() }));
  }

  // ---------- coupons ----------

  async coupons() {
    const rows = await this.ctx.db.query<{
      code: string;
      kind: 'percent' | 'fixed' | 'free_shipping';
      value: string;
      description: string;
      min_subtotal: string;
      max_uses: number | null;
      per_customer_limit: number | null;
      first_order_only: boolean;
      excludes_sale_items: boolean;
      starts_at: Date | null;
      ends_at: Date | null;
      active: boolean;
      uses: number;
    }>(
      `SELECT c.*, (SELECT count(*)::int FROM coupon_redemptions r WHERE r.coupon_code = c.code AND r.released_at IS NULL) AS uses
         FROM coupons c ORDER BY c.code`,
    );
    return rows.map((c) => ({
      code: c.code,
      kind: c.kind,
      value: c.value,
      description: c.description,
      minSubtotal: toCents(c.min_subtotal) > 0 ? c.min_subtotal : null,
      maxUses: c.max_uses,
      perCustomerLimit: c.per_customer_limit,
      firstOrderOnly: c.first_order_only,
      excludesSaleItems: c.excludes_sale_items,
      startsAt: c.starts_at?.toISOString() ?? null,
      endsAt: c.ends_at?.toISOString() ?? null,
      active: c.active,
      uses: c.uses,
    }));
  }

  async editCoupon(code: string, user: CurrentUser, edit: { active?: boolean; maxUses?: number | null; endsAt?: string | null; description?: string }, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const { rows } = await tx.query<{ active: boolean; max_uses: number | null; ends_at: Date | null; description: string }>(
        'SELECT active, max_uses, ends_at, description FROM coupons WHERE code = $1 FOR UPDATE',
        [code],
      );
      const c = rows[0];
      if (!c) throw notFound('That coupon');
      const before = { active: c.active, maxUses: c.max_uses, endsAt: c.ends_at?.toISOString() ?? null, description: c.description };
      const changes = diff(before, edit);
      if (!changes.changed) return;
      await tx.query(
        `UPDATE coupons SET active = $2, max_uses = $3, ends_at = $4, description = $5 WHERE code = $1`,
        [code, edit.active ?? c.active, edit.maxUses === undefined ? c.max_uses : edit.maxUses, edit.endsAt === undefined ? c.ends_at : edit.endsAt, edit.description ?? c.description],
      );
      await audit(tx, user, 'coupon.update', { type: 'coupon', id: code }, changes, now);
    });
    return (await this.coupons()).find((c) => c.code === code)!;
  }

  // ---------- shipping and tax ----------

  async rates() {
    const rows = await this.ctx.db.query<{ zone_code: string; zone_name: string; method: 'standard' | 'express'; price: string; free_from: string | null; days_min: number; days_max: number }>(
      `SELECT r.zone_code, z.name AS zone_name, r.method, r.price, r.free_from, r.days_min, r.days_max
         FROM shipping_rates r JOIN shipping_zones z ON z.code = r.zone_code ORDER BY z.position, r.method`,
    );
    return rows.map((r) => ({ zone: r.zone_code, zoneName: r.zone_name, method: r.method, price: r.price, freeFrom: r.free_from, daysMin: r.days_min, daysMax: r.days_max }));
  }

  async editRate(zone: string, method: 'standard' | 'express', user: CurrentUser, edit: { price: string; freeFrom: string | null }, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const { rows } = await tx.query<{ price: string; free_from: string | null }>(
        'SELECT price, free_from FROM shipping_rates WHERE zone_code = $1 AND method = $2 FOR UPDATE',
        [zone, method],
      );
      const r = rows[0];
      if (!r) throw notFound('That shipping rate');
      if (edit.freeFrom !== null && toCents(edit.freeFrom) <= 0) throw fieldError('freeFrom', 'Above 0.00, or leave empty for never free.');
      await tx.query('UPDATE shipping_rates SET price = $3, free_from = $4 WHERE zone_code = $1 AND method = $2', [zone, method, edit.price, edit.freeFrom]);
      await audit(tx, user, 'shipping_rate.update', { type: 'shipping_rate', id: `${zone}/${method}` }, { before: { price: r.price, freeFrom: r.free_from }, after: edit }, now);
    });
    return (await this.rates()).find((r) => r.zone === zone && r.method === method)!;
  }

  async taxRate(): Promise<string> {
    const row = await this.ctx.db.one<{ value: unknown }>("SELECT value FROM shop_settings WHERE key = 'tax_rate_percent'");
    return String(row?.value ?? '8');
  }

  async setTaxRate(user: CurrentUser, ratePercent: string, now: Date) {
    const rate = Number(ratePercent);
    if (!(rate >= 0 && rate <= 30)) throw fieldError('ratePercent', 'Between 0 and 30.');
    await this.ctx.db.tx(async (tx) => {
      const before = await this.taxRate();
      await tx.query("UPDATE shop_settings SET value = $1 WHERE key = 'tax_rate_percent'", [JSON.stringify(rate)]);
      await audit(tx, user, 'tax_rate.update', { type: 'setting', id: 'tax_rate_percent' }, { before, after: String(rate) }, now);
    });
    return this.taxRate();
  }

  // ---------- customers ----------

  async customers(q: { q?: string; role?: Role }, cursor: string | null, limit: number) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
    }
    if (q.role) {
      params.push(q.role);
      where.push(`c.role = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      where.push(`c.id < $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await this.ctx.db.query<{ id: string; name: string; email: string; role: Role; email_verified_at: Date | null; locked_until: Date | null; created_at: Date; order_count: number }>(
      `SELECT c.id, c.name, c.email, c.role, c.email_verified_at, c.locked_until, c.created_at,
              (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS order_count
         FROM customers c ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        role: c.role,
        emailVerified: c.email_verified_at !== null,
        orderCount: c.order_count,
        lockedUntil: c.locked_until?.toISOString() ?? null,
        createdAt: c.created_at.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async setRole(id: string, user: CurrentUser, role: Role, now: Date) {
    if (id === user.id) throw new AppError('forbidden', 'You cannot change your own role.');
    await this.ctx.db.tx(async (tx) => {
      const { rows } = await tx.query<{ role: Role }>('SELECT role FROM customers WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw notFound('That account');
      if (rows[0].role === role) return;
      await tx.query('UPDATE customers SET role = $2, updated_at = $3 WHERE id = $1', [id, role, now]);
      // A role change signs the account out everywhere, so the new permissions apply at once.
      await tx.query('DELETE FROM sessions WHERE customer_id = $1', [id]);
      await audit(tx, user, 'customer.role', { type: 'customer', id }, { before: { role: rows[0].role }, after: { role } }, now);
    });
  }

  // ---------- audit ----------

  async auditLog(q: { entityType?: string; entityId?: string; actorId?: string }, cursor: string | null, limit: number) {
    const params: unknown[] = [];
    const where: string[] = [];
    for (const [col, v] of [
      ['a.entity_type', q.entityType],
      ['a.entity_id', q.entityId],
      ['a.actor_id', q.actorId],
    ] as const) {
      if (v) {
        params.push(v);
        where.push(`${col} = $${params.length}`);
      }
    }
    if (cursor) {
      params.push(cursor);
      where.push(`a.id < $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await this.ctx.db.query<{
      id: string;
      actor_id: string | null;
      actor_name: string | null;
      actor_role: Role | null;
      action: string;
      entity_type: string;
      entity_id: string;
      before: unknown;
      after: unknown;
      request_id: string | null;
      created_at: Date;
    }>(
      `SELECT a.*, c.name AS actor_name FROM audit_log a LEFT JOIN customers c ON c.id = a.actor_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((a) => ({
        id: a.id,
        actor: a.actor_id && a.actor_role ? { id: a.actor_id, name: a.actor_name ?? '', role: a.actor_role } : null,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        before: a.before,
        after: a.after,
        requestId: a.request_id,
        at: a.created_at.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

/** Queues one email to the warehouse when a product drops to or under its low-stock threshold. */
export async function lowStockCheck(ctx: AppContext, db: Queryable, productId: string, now: Date) {
  const { rows } = await db.query<{ name: string; sku: string; available: number; threshold: number }>(
    `SELECT p.name, p.sku, sl.available, p.low_stock_threshold AS threshold
       FROM products p JOIN stock_levels sl ON sl.product_id = p.id WHERE p.id = $1`,
    [productId],
  );
  const p = rows[0];
  if (!p || p.available > p.threshold) return;
  // One alert per product per day is enough.
  const { rows: sent } = await db.query(
    "SELECT 1 FROM outbox WHERE template = 'low_stock' AND data->>'sku' = $1 AND created_at > $2::timestamptz - interval '1 day'",
    [p.sku, now],
  );
  if (sent.length) return;
  await queueEmail(
    db,
    'warehouse@halden.test',
    'low_stock',
    { product: p.name, sku: p.sku, available: p.available, threshold: p.threshold, link: `${ctx.config.APP_URL}/staff/products/${productId}` },
    now,
  );
}
