// Review rules (DESIGN.md 3.12):
//   - Only verified buyers: the customer has a delivered (or completed) order line for the product, and has not
//     returned and been refunded for every unit of it.
//   - One review per customer per product. Editable for 30 days after posting; deletable any time.
//   - Published straight away unless it has a link, an email address or a blocked word: then it waits for support.
//   - Support can hide a review with a reason (the author is emailed) or publish a held or hidden one.
//   - A product's rating is the average of its published reviews, to one decimal, with their count; it's stored on
//     the product and updated in the same transaction as every review change.
//   - Signed-in customers can mark a published review helpful once, but not their own.
import { REVIEW_EDIT_DAYS, type OwnReview, type Review, type ReviewSort, type ReviewStatus } from '@halden/contracts';
import type pg from 'pg';
import { audit } from '../../core/audit.js';
import type { CurrentUser } from '../../core/auth.js';
import type { AppContext } from '../../core/context.js';
import type { Queryable } from '../../core/db.js';
import { AppError, fieldError, notFound } from '../../core/errors.js';
import { queueEmail } from '../../core/outbox.js';

type Fit = 'runs_small' | 'true_to_size' | 'runs_large';
export type ReviewInput = { rating: number; title: string; body: string; fit: Fit | null };

type Row = {
  id: string;
  product_id: string;
  customer_id: string;
  rating: number;
  title: string;
  body: string;
  fit: Fit | null;
  status: ReviewStatus;
  held_for: string | null;
  hidden_reason: string | null;
  helpful_count: number;
  created_at: Date;
  edited_at: Date | null;
  author_name: string;
};

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|co|shop|info|biz)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
/** Words that hold a review for a person to read. Kept short on purpose: it's a demo of the rule, not a filter. */
const BLOCKLIST = ['scam', 'idiot', 'stupid', 'garbage', 'fraud', 'damn'];

/** Why a review needs a person to read it first, or null to publish it straight away. */
export function holdReason(text: string): string | null {
  if (EMAIL.test(text)) return 'Contains an email address';
  if (LINK.test(text)) return 'Contains a link';
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const blocked = BLOCKLIST.find((w) => words.includes(w));
  return blocked ? `Contains a blocked word (${blocked})` : null;
}

/** "Maya Okafor" -> "Maya O." */
export const authorName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : (first ?? 'Customer');
};

const day = 86400_000;
const ORDER: Record<ReviewSort, string> = {
  helpful: 'r.helpful_count DESC, r.created_at DESC, r.id DESC',
  newest: 'r.created_at DESC, r.id DESC',
  highest: 'r.rating DESC, r.created_at DESC, r.id DESC',
  lowest: 'r.rating ASC, r.created_at DESC, r.id DESC',
};
const SELECT = `SELECT r.*, c.name AS author_name FROM reviews r JOIN customers c ON c.id = r.customer_id`;

export class ReviewService {
  constructor(private readonly ctx: AppContext) {}

  private async product(db: Queryable, slug: string) {
    const { rows } = await db.query<{ id: string; sized: boolean; name: string }>('SELECT id, sized, name FROM products WHERE slug = $1 AND active', [slug]);
    if (!rows[0]) throw notFound('That product');
    return rows[0];
  }

  /** Why this customer can't review this product, or null if they can. */
  async blocker(db: Queryable, customerId: string, productId: string): Promise<string | null> {
    const { rows } = await db.query<{ bought: number; refunded: number }>(
      `SELECT coalesce(sum(oi.qty) FILTER (WHERE o.status IN ('delivered', 'completed')), 0)::int AS bought,
              (SELECT coalesce(sum(ri.qty), 0)::int FROM return_items ri
                 JOIN returns r ON r.id = ri.return_id JOIN order_items x ON x.id = ri.order_item_id
                WHERE r.customer_id = $1 AND x.product_id = $2 AND r.status IN ('refunded', 'partially_refunded')
                  AND ri.refund_amount > 0) AS refunded
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.customer_id = $1 AND oi.product_id = $2`,
      [customerId, productId],
    );
    const r = rows[0] ?? { bought: 0, refunded: 0 };
    if (r.bought === 0) return 'Only customers who bought this and received it can review it.';
    if (r.refunded >= r.bought) return 'You returned this product, so you can no longer review it.';
    return null;
  }

  /** Recomputes a product's stored rating from its reviews. Planted bug hidden_reviews_counted keeps hidden ones in. */
  async rerate(tx: Queryable, productId: string) {
    const counted = (await this.ctx.bugs.enabled('hidden_reviews_counted', tx)) ? "('published', 'hidden')" : "('published')";
    await tx.query(
      `UPDATE products p SET rating_avg = s.avg, rating_count = s.n, updated_at = now()
         FROM (SELECT round(avg(rating), 1) AS avg, count(*)::int AS n FROM reviews WHERE product_id = $1 AND status IN ${counted}) s
        WHERE p.id = $1`,
      [productId],
    );
  }

  // ---------- customers ----------

  async create(slug: string, user: CurrentUser, input: ReviewInput, now: Date): Promise<string> {
    return this.ctx.db.tx(async (tx) => {
      const p = await this.product(tx, slug);
      if (input.fit && !p.sized) throw fieldError('fit', 'Fit is only asked for sized products.');
      const blocked = await this.blocker(tx, user.id, p.id);
      if (blocked) throw new AppError('review_not_allowed', blocked);
      const held = holdReason(`${input.title} ${input.body}`);
      try {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO reviews (product_id, customer_id, rating, title, body, fit, status, held_for, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
          [p.id, user.id, input.rating, input.title, input.body, input.fit, held ? 'pending' : 'published', held, now],
        );
        await this.rerate(tx, p.id);
        return rows[0]!.id;
      } catch (err) {
        if ((err as pg.DatabaseError).code === '23505') throw new AppError('already_reviewed', 'You have already reviewed this product. Edit your review instead.');
        throw err;
      }
    });
  }

  async update(id: string, user: CurrentUser, input: ReviewInput, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.customer_id !== user.id) throw notFound('That review');
      if (r.status === 'hidden') throw new AppError('invalid_transition', 'A hidden review cannot be edited. You can delete it.');
      if (now.getTime() > r.created_at.getTime() + REVIEW_EDIT_DAYS * day) {
        throw new AppError('invalid_transition', `Reviews can be edited for ${REVIEW_EDIT_DAYS} days after posting.`);
      }
      const { rows } = await tx.query<{ sized: boolean }>('SELECT sized FROM products WHERE id = $1', [r.product_id]);
      if (input.fit && !rows[0]?.sized) throw fieldError('fit', 'Fit is only asked for sized products.');
      const held = holdReason(`${input.title} ${input.body}`);
      await tx.query(
        `UPDATE reviews SET rating = $2, title = $3, body = $4, fit = $5, status = $6, held_for = $7, edited_at = $8, updated_at = $8
          WHERE id = $1`,
        [id, input.rating, input.title, input.body, input.fit, held ? 'pending' : 'published', held, now],
      );
      await this.rerate(tx, r.product_id);
    });
  }

  async remove(id: string, user: CurrentUser) {
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, id);
      const staff = user.role === 'support' || user.role === 'admin';
      if (r.customer_id !== user.id && !staff) throw notFound('That review');
      // A hidden review stays (and keeps its product slot), or deleting and posting it again would undo moderation.
      if (r.status === 'hidden' && !staff) throw new AppError('forbidden', 'This review was hidden by our team, so it cannot be deleted. Contact support.');
      await tx.query('DELETE FROM reviews WHERE id = $1', [id]);
      await this.rerate(tx, r.product_id);
      if (r.customer_id !== user.id) await audit(tx, user, 'review.delete', { type: 'review', id }, { before: this.snapshot(r) });
    });
  }

  async vote(id: string, user: CurrentUser, helpful: boolean, now: Date) {
    // Only confirmed accounts vote, which makes stuffing votes from throwaway accounts slower.
    if (!user.emailVerified) throw new AppError('email_not_verified', 'Confirm your email address before voting on reviews.');
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.status !== 'published') throw notFound('That review');
      if (r.customer_id === user.id) throw new AppError('forbidden', 'You cannot vote on your own review.');
      if (helpful) {
        const { rowCount } = await tx.query(
          'INSERT INTO review_votes (review_id, customer_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [id, user.id, now],
        );
        if (!rowCount) throw new AppError('conflict', 'You have already marked this review helpful.');
      } else {
        await tx.query('DELETE FROM review_votes WHERE review_id = $1 AND customer_id = $2', [id, user.id]);
      }
      await tx.query('UPDATE reviews SET helpful_count = (SELECT count(*) FROM review_votes WHERE review_id = $1) WHERE id = $1', [id]);
    });
  }

  // ---------- support ----------

  async hide(id: string, user: CurrentUser, reason: string, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.status === 'hidden') throw new AppError('invalid_transition', 'This review is already hidden.');
      await tx.query("UPDATE reviews SET status = 'hidden', hidden_reason = $2, moderated_by = $3, updated_at = $4 WHERE id = $1", [id, reason, user.id, now]);
      await this.rerate(tx, r.product_id);
      await audit(tx, user, 'review.hide', { type: 'review', id }, { before: { status: r.status }, after: { status: 'hidden', reason } }, now);
      const { rows } = await tx.query<{ email: string; name: string; product: string; slug: string }>(
        'SELECT c.email, c.name, p.name AS product, p.slug FROM customers c, products p WHERE c.id = $1 AND p.id = $2',
        [r.customer_id, r.product_id],
      );
      const c = rows[0]!;
      await queueEmail(
        tx,
        c.email,
        'review_hidden',
        { name: c.name, product: c.product, reason, link: `${this.ctx.config.APP_URL}/account/reviews` },
        now,
      );
    });
  }

  async publish(id: string, user: CurrentUser, now: Date) {
    await this.ctx.db.tx(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.status === 'published') throw new AppError('invalid_transition', 'This review is already published.');
      await tx.query(
        "UPDATE reviews SET status = 'published', held_for = NULL, hidden_reason = NULL, moderated_by = $2, updated_at = $3 WHERE id = $1",
        [id, user.id, now],
      );
      await this.rerate(tx, r.product_id);
      await audit(tx, user, 'review.publish', { type: 'review', id }, { before: { status: r.status }, after: { status: 'published' } }, now);
    });
  }

  // ---------- reading ----------

  private async lock(tx: Queryable, id: string): Promise<Row> {
    const { rows } = await tx.query<Row>(`${SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    if (!rows[0]) throw notFound('That review');
    return rows[0];
  }

  private snapshot = (r: Row) => ({ rating: r.rating, title: r.title, status: r.status, customerId: r.customer_id });

  private toReview(r: Row, viewerId: string | null, voted: Set<string>): Review {
    return {
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      fit: r.fit,
      author: authorName(r.author_name),
      verifiedBuyer: true,
      helpfulCount: r.helpful_count,
      votedHelpful: voted.has(r.id),
      mine: r.customer_id === viewerId,
      createdAt: r.created_at.toISOString(),
      editedAt: r.edited_at?.toISOString() ?? null,
    };
  }

  async page(slug: string, viewer: CurrentUser | null, q: { sort: ReviewSort; rating?: number; cursor?: string; limit: number }) {
    const p = await this.product(this.ctx.db.pool, slug);
    const offset = Number(q.cursor ?? 0);
    const params: unknown[] = [p.id];
    let filter = '';
    if (q.rating) {
      params.push(q.rating);
      filter = ` AND r.rating = $${params.length}`;
    }
    params.push(q.limit + 1, offset);
    const rows = await this.ctx.db.query<Row>(
      `${SELECT} WHERE r.product_id = $1 AND r.status = 'published'${filter}
        ORDER BY ${ORDER[q.sort]} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const page = rows.slice(0, q.limit);
    const voted = viewer
      ? new Set(
          (
            await this.ctx.db.query<{ review_id: string }>('SELECT review_id FROM review_votes WHERE customer_id = $1 AND review_id = ANY($2)', [
              viewer.id,
              page.map((r) => r.id),
            ])
          ).map((v) => v.review_id),
        )
      : new Set<string>();

    const stats = await this.ctx.db.query<{ rating: number; fit: Fit | null; n: number }>(
      "SELECT rating, fit, count(*)::int AS n FROM reviews WHERE product_id = $1 AND status = 'published' GROUP BY rating, fit",
      [p.id],
    );
    const product = await this.ctx.db.one<{ rating_avg: string | null; rating_count: number }>('SELECT rating_avg, rating_count FROM products WHERE id = $1', [p.id]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    const fit = { runs_small: 0, true_to_size: 0, runs_large: 0 };
    for (const s of stats) {
      distribution[s.rating as 1] += s.n;
      if (s.fit) fit[s.fit] += s.n;
    }

    let viewerInfo = null;
    if (viewer) {
      const mine = await this.ctx.db.one<{ id: string }>('SELECT id FROM reviews WHERE product_id = $1 AND customer_id = $2', [p.id, viewer.id]);
      const blocked = mine ? 'You have already reviewed this product.' : await this.blocker(this.ctx.db.pool, viewer.id, p.id);
      viewerInfo = { canReview: !blocked, reason: blocked, myReviewId: mine?.id ?? null };
    }
    return {
      items: page.map((r) => this.toReview(r, viewer?.id ?? null, voted)),
      nextCursor: rows.length > q.limit ? String(offset + q.limit) : null,
      summary: {
        // The stored rating, so the page shows what the product card shows (and what the rules check).
        average: product?.rating_avg === null || product?.rating_avg === undefined ? null : Number(product.rating_avg),
        count: product?.rating_count ?? 0,
        distribution,
        fit: p.sized ? fit : null,
      },
      viewer: viewerInfo,
    };
  }

  /** A customer's own reviews, or (staff) reviews by status. */
  async moderationList(filter: { customerId?: string; status?: ReviewStatus }, staff: boolean, cursor: string | null, limit: number): Promise<{ items: OwnReview[]; nextCursor: string | null }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filter.customerId) {
      params.push(filter.customerId);
      where.push(`r.customer_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`r.status = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor);
      where.push(`r.id < $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await this.ctx.db.query<Row & { email: string; slug: string; product_name: string; sized: boolean; image: string | null }>(
      `SELECT r.*, c.name AS author_name, c.email, p.slug, p.name AS product_name, p.sized,
              (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image
         FROM reviews r JOIN customers c ON c.id = r.customer_id JOIN products p ON p.id = r.product_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY r.id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        ...this.toReview(r, filter.customerId ?? null, new Set()),
        status: r.status,
        heldFor: r.held_for,
        hiddenReason: r.hidden_reason,
        editableUntil: r.status === 'hidden' ? null : new Date(r.created_at.getTime() + REVIEW_EDIT_DAYS * day).toISOString(),
        product: { id: r.product_id, slug: r.slug, name: r.product_name, image: r.image ?? '', sized: r.sized },
        customer: staff ? { id: r.customer_id, name: r.author_name, email: r.email } : null,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async own(id: string, user: CurrentUser): Promise<OwnReview> {
    const staff = user.role === 'support' || user.role === 'admin';
    const r = await this.ctx.db.one<{ customer_id: string }>('SELECT customer_id FROM reviews WHERE id = $1', [id]);
    if (!r || (r.customer_id !== user.id && !staff)) throw notFound('That review');
    // The newest of the author's reviews with an id up to this one is this one.
    const { items } = await this.moderationList({ customerId: r.customer_id }, staff, String(BigInt(id) + 1n), 1);
    return { ...items[0]!, mine: r.customer_id === user.id };
  }
}
