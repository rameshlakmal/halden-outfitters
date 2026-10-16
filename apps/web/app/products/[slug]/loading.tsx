import { Skeleton } from '@/components/ui/bits';

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading product">
      <Skeleton className="mb-6 h-6 w-28 rounded-[2px]" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <Skeleton className="aspect-square w-full rounded-[2px]" />
        <div className="grid content-start gap-5">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-14 w-full rounded-[2px]" />
        </div>
      </div>
    </div>
  );
}
