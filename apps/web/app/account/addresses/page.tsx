import type { Metadata } from 'next';
import { AddressBook } from '@/components/account/addresses';

export const metadata: Metadata = { title: 'Addresses' };

export default function AddressesPage() {
  return <AddressBook />;
}
