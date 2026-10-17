import { Star } from '@phosphor-icons/react';

/** One rating as five stars, with the number for screen readers. */
export function StarRow({ rating, size = 'size-4' }: { rating: number; size?: string }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          weight={rating >= n - 0.25 ? 'fill' : 'regular'}
          className={`${size} text-accent`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
