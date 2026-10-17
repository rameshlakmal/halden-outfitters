import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuditLog } from '@/components/staff/audit';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
