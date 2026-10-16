import type { Metadata } from 'next';
import { ShopView } from '@/components/product/shop-view';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: q ? `Search: ${String(q).slice(0, 40)}` : 'Search', robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const search = await searchParams;
  const q = String(search.q ?? '').trim();
  return <ShopView search={search} category={null} title={q ? `Results for "${q.slice(0, 60)}"` : 'Search the shop'} />;
}
