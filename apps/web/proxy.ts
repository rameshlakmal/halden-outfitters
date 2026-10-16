// Runs before routing, so it can still set the status code.
//  - /account/*: an optimistic check only. No session cookie means "not signed in", so go to sign-in first.
//    The API still checks the session on every request; a stale cookie is caught there.
//  - /shop/<category>: unknown categories get a real 404. The page itself streams (it reads the filters from
//    the URL), and once streaming has started the status can no longer change.
import { type NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
let categories: { slugs: Set<string>; at: number } | null = null;

async function knownCategories(): Promise<Set<string> | null> {
  if (categories && Date.now() - categories.at < 60_000) return categories.slugs;
  try {
    const res = await fetch(`${API_URL}/api/v1/categories`, { headers: { accept: 'application/json' } });
    if (!res.ok) return categories?.slugs ?? null;
    const body = (await res.json()) as { items: { slug: string }[] };
    categories = { slugs: new Set(body.items.map((c) => c.slug)), at: Date.now() };
    return categories.slugs;
  } catch {
    return categories?.slugs ?? null; // API down: let the page decide
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/shop/')) {
    const slug = pathname.slice('/shop/'.length);
    const known = await knownCategories();
    if (known && (slug.includes('/') || !known.has(slug))) {
      return NextResponse.rewrite(new URL('/not-found-page', request.url), { status: 404 });
    }
    return NextResponse.next();
  }

  if (request.cookies.has('halden_session')) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/account/:path*', '/shop/:path+'] };
