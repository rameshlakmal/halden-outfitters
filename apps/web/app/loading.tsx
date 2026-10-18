import { BrandLoader } from '@/components/ui/bits';

// Shown while the next page renders. Pages with their own loading.tsx (the shop grid) keep their skeleton.
export default function Loading() {
  return <BrandLoader label="Loading the page" className="min-h-[60vh]" />;
}
