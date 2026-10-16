import { Skeleton } from '@/components/ui/bits';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-[var(--gutter)] pt-10 " aria-busy="true" aria-label="Loading products">
      <Skeleton className="mb-4 h-12 w-64" />
      <Skeleton className="mb-10 h-5 w-96 max-w-full" />
      <div className="mb-8 flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-[2px]" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="grid gap-3">
            <Skeleton className="aspect-[4/5] w-full rounded-[2px]" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
