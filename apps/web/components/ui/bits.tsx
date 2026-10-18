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

// The mountains logo from icon.svg, split so the loader can draw the ridge and then raise the sun.
const RIDGE =
  'M254.88,195.92l-54.56-92.08A15.87,15.87,0,0,0,186.55,96h0a15.85,15.85,0,0,0-13.76,7.84l-15.64,26.39a4,4,0,0,0,0,4.07l26.8,45.47a8.13,8.13,0,0,1-1.89,10.55,8,8,0,0,1-11.8-2.26L101.79,71.88a16,16,0,0,0-27.58,0L1.11,195.94a8,8,0,0,0,1,9.52A8.23,8.23,0,0,0,8.23,208H247.77a8.29,8.29,0,0,0,6.09-2.55A8,8,0,0,0,254.88,195.92Z';

/** The loading screen: the logo's ridge draws itself, fills, and the sun pops in (CSS in globals.css). */
export function BrandLoader({ label = 'Loading', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`grid place-items-center ${className}`}>
      <svg viewBox="0 -8 256 256" className="brand-loader size-14" aria-hidden="true">
        <path className="ridge" pathLength={1} d={RIDGE} />
        <path className="peaks" d={`${RIDGE}M64.43,120,88,80l23.57,40Z`} />
        <circle className="sun" cx="164" cy="52" r="24" />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
