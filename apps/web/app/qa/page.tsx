import type { Metadata } from 'next';
import { QaLab } from '@/components/staff/qa-lab';
import { StaffShell } from '@/components/staff/shell';

export const metadata: Metadata = { title: 'QA lab', robots: { index: false } };

// The QA lab lives in the staff console frame (admin only). The fake inbox at /qa/inbox stays open to anyone,
// so testers can follow email links while signed out.
export default function QaPage() {
  return (
    <StaffShell>
      <QaLab />
    </StaffShell>
  );
}
