import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShopView } from '@/components/product/shop-view';
import { getCategories } from '@/lib/server-api';

type Props = {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Only the shop's categories exist; any other /shop/<name> is a 404 at routing, before anything streams.
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getCategories()).map((c) => ({ category: c.slug }));
}

async function find(params: Props['params']) {
  const { category } = await params;
  const found = (await getCategories()).find((c) => c.slug === category);
  if (!found) notFound();
  return found;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await find(params);
  return { title: c.name, description: c.blurb };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const c = await find(params);
  return <ShopView search={await searchParams} category={c.slug} title={c.name} blurb={c.blurb} />;
}
