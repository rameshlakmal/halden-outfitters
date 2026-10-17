import type { Metadata } from 'next';
import { ReviewModeration } from '@/components/staff/reviews';

export const metadata: Metadata = { title: 'Reviews' };

export default function Page() {
  return <ReviewModeration />;
}
