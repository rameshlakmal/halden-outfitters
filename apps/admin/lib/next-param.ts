/**
 * Only same-site paths: "/orders" is fine, "//evil.example" and "https://..." are not. The value is resolved the way the
 * browser would ("/\t/evil.example" becomes "//evil.example" once tabs are stripped) and must stay on this site.
 * The same rule as the shop's sign-in (apps/web/components/account/forms.ts).
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what's being refused
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\\]/.test(next)) return fallback;
  const base = 'https://halden.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  return url.pathname + url.search + url.hash;
}
