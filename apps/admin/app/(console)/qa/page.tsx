import type { Metadata } from 'next';
import { QaLab } from '@/components/staff/qa-lab';

export const metadata: Metadata = { title: 'QA lab' };

export default function Page() {
  return <QaLab />;
}
