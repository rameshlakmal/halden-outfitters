import { z } from 'zod';
import { Id, Slug, Timestamp } from './common.ts';

export const REVIEW_STATUSES = ['published', 'pending', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_FITS = ['runs_small', 'true_to_size', 'runs_large'] as const;
export const REVIEW_SORTS = ['helpful', 'newest', 'highest', 'lowest'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

/** How long after posting a review can still be edited. */
export const REVIEW_EDIT_DAYS = 30;

export const ReviewInput = z.object({
  rating: z.number().int().min(1, 'Choose 1 to 5 stars.').max(5, 'Choose 1 to 5 stars.'),
  title: z.string().trim().min(5, 'At least 5 characters.').max(80, 'At most 80 characters.'),
  body: z.string().trim().min(20, 'At least 20 characters.').max(2000, 'At most 2000 characters.'),
  fit: z.enum(REVIEW_FITS).nullable().default(null).describe('Only for sized products'),
});

export const Review = z
  .object({
    id: Id,
    rating: z.number().int(),
    title: z.string(),
    body: z.string(),
    fit: z.enum(REVIEW_FITS).nullable(),
    author: z.string().describe('First name and last initial'),
    verifiedBuyer: z.literal(true),
    helpfulCount: z.number().int(),
    votedHelpful: z.boolean().describe('The viewer marked it helpful'),
    mine: z.boolean(),
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
  })
  .meta({ id: 'Review' });
export type Review = z.infer<typeof Review>;

const count = z.number().int();

export const RatingSummary = z
  .object({
    average: z.number().nullable(),
    count,
    distribution: z.object({ 1: count, 2: count, 3: count, 4: count, 5: count }),
    fit: z.object({ runs_small: count, true_to_size: count, runs_large: count }).nullable(),
  })
  .meta({ id: 'RatingSummary' });

export const ReviewViewer = z
  .object({
    canReview: z.boolean(),
    reason: z.string().nullable().describe('Why the viewer cannot review, if so'),
    myReviewId: Id.nullable(),
  })
  .meta({ id: 'ReviewViewer' });

export const ReviewPage = z
  .object({
    items: z.array(Review),
    nextCursor: z.string().nullable(),
    summary: RatingSummary,
    viewer: ReviewViewer.nullable().describe('Null when signed out'),
  })
  .meta({ id: 'ReviewPage' });

export const ReviewQuery = z.object({
  sort: z.enum(REVIEW_SORTS).default('helpful'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z
    .string()
    .regex(/^\d{1,6}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** A review as its author or staff sees it, with its moderation state. */
export const OwnReview = Review.extend({
  status: z.enum(REVIEW_STATUSES),
  heldFor: z.string().nullable(),
  hiddenReason: z.string().nullable(),
  editableUntil: Timestamp.nullable(),
  product: z.object({ id: Id, slug: Slug, name: z.string(), image: z.string(), sized: z.boolean() }),
  customer: z.object({ id: Id, name: z.string(), email: z.string() }).nullable().describe('Staff only'),
}).meta({ id: 'OwnReview' });
export type OwnReview = z.infer<typeof OwnReview>;

export const HideReview = z.object({ reason: z.string().trim().min(3).max(300) });
