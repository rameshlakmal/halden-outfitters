import type { Metadata } from 'next';
import { MyReviews } from '@/components/reviews/my-reviews';

export const metadata: Metadata = { title: 'Your reviews' };

export default function Reviews() {
  return <MyReviews />;
}
