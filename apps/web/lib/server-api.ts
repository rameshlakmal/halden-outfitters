// Server-side reads for Server Components. Catalogue data has no cookies, so pages can be cached and
// regenerated in the background (ISR) and the HTML arrives fast.
import 'server-only';
import type { Category, Product, ProductPage } from '@halden/contracts';
import { notFound } from 'next/navigation';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
export const CATALOG_REVALIDATE = 60;

async function read<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    next: { revalidate: CATALOG_REVALIDATE, tags: ['catalog'] },
    headers: { accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export async function getCategories(): Promise<Category[]> {
  return (await read<{ items: Category[] }>('/categories'))?.items ?? [];
}

export async function getProducts(params: Record<string, string | undefined> = {}): Promise<ProductPage> {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  const page = await read<ProductPage>(`/products${qs.size ? `?${qs}` : ''}`);
  if (!page) throw new Error('product list missing');
  return page;
}

export async function getProduct(slug: string): Promise<Product> {
  const product = await read<Product>(`/products/${encodeURIComponent(slug)}`);
  if (!product) notFound();
  return product;
}
