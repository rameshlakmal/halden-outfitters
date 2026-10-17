import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { StaffShell } from '@/components/staff/shell';

export const metadata: Metadata = {
  title: { default: 'Staff console', template: '%s | Staff console' },
  robots: { index: false },
};

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <StaffShell>{children}</StaffShell>;
}
