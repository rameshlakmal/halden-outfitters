import type { Metadata } from 'next';
import { PointsPage } from '@/components/account/rewards';

export const metadata: Metadata = { title: 'Halden Points' };

export default function Points() {
  return <PointsPage />;
}
