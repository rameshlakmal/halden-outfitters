import type { Metadata } from 'next';
import { CustomerList } from '@/components/staff/customers';

export const metadata: Metadata = { title: 'Customers' };

export default function Page() {
  return <CustomerList />;
}
