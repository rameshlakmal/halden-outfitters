import type { Metadata } from 'next';
import { ShopView } from '@/components/product/shop-view';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = {
  title: 'Shop all gear',
  description: 'Every tent, sleeping bag, stove and pack in the shop.',
};

export default async function ShopPage({ searchParams }: Props) {
  return (
    <ShopView
      search={await searchParams}
      category={null}
      title="All gear"
      blurb="Everything for a night out, from the tent to the mug."
    />
  );
}
