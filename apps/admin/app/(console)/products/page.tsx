import type { Metadata } from 'next';
import { ProductList } from '@/components/staff/products';

export const metadata: Metadata = { title: 'Products' };

export default function Page() {
  return <ProductList />;
}
