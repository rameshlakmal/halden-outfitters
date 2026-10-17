// Runs before routing: no session cookie means "not signed in", so go to sign-in first. An optimistic check only;
// the API checks the session and the role on every request, and the shell catches a stale cookie.
import { type NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  if (request.cookies.has('halden_session')) return NextResponse.next();
  const url = request.nextUrl.clone();
  const { pathname, search } = request.nextUrl;
  url.pathname = '/sign-in';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(`${pathname}${search}`)}`;
  return NextResponse.redirect(url);
}

// Everything except sign-in, the API rewrite, Next's own files and the icons.
export const config = { matcher: ['/((?!sign-in|api/|_next/|icon|apple-icon|favicon).*)'] };
