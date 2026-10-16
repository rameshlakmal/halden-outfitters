import type { ProductCard } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { Star } from '@phosphor-icons/react/dist/ssr';

export function Price({
  amount,
  was,
  size = 'md',
}: {
  amount: string;
  was?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}) {
  const text = { sm: 'text-[15px]', md: 'text-base', lg: 'text-2xl' }[size];
  return (
    <span className={`inline-flex items-baseline gap-2 tabular-nums ${text}`}>
      <span className={`font-semibold ${was ? 'text-brand' : 'text-ink'}`}>{formatAmount(amount)}</span>
      {was && (
        <span className="text-[0.85em] text-ink-3 line-through decoration-1">
          <span className="sr-only">was </span>
          {formatAmount(was)}
        </span>
      )}
    </span>
  );
}

export function Stars({ average, count }: { average: number | null; count: number }) {
  if (count === 0 || average === null) return <span className="text-sm text-ink-3">No reviews yet</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
      <span className="flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} weight={average >= n - 0.25 ? 'fill' : 'regular'} className="size-4 text-accent" />
        ))}
      </span>
      <span>
        {average.toFixed(1)} <span className="text-ink-3">({count})</span>
      </span>
    </span>
  );
}

export function AvailabilityNote({ availability }: { availability: ProductCard['availability'] }) {
  if (availability.status === 'out_of_stock') return <span className="text-sm font-medium text-danger">Sold out</span>;
  if (availability.status === 'low_stock') {
    return <span className="text-sm font-medium text-ink-2">Only {availability.available} left</span>;
  }
  return <span className="text-sm text-ink-3">In stock</span>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-[2px] ${className}`} aria-hidden="true" />;
}
