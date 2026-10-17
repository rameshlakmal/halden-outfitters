import type { NextConfig } from 'next';

// Like the shop: the browser only talks to this origin, and /api/v1/* is forwarded to the API, so the session
// cookie is first-party here. The API must list this origin in ALLOWED_ORIGINS for writes to pass its Origin check.
const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';
// Product photos: the shop's own files, and uploads in Vercel Blob (the browser sends them there directly).
const SHOP_ORIGIN = new URL(process.env.NEXT_PUBLIC_SHOP_URL ?? 'http://localhost:3001').origin;
const BLOB_IMAGES = 'https://*.public.blob.vercel-storage.com';
const BLOB_API = 'https://vercel.com/api/blob https://*.blob.vercel-storage.com';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Staff pages are never for search engines.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: blob: ${SHOP_ORIGIN} ${BLOB_IMAGES}`,
      "font-src 'self'",
      `connect-src 'self' ${BLOB_API}`,
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@halden/contracts', '@halden/money'],
  experimental: { optimizePackageImports: ['@phosphor-icons/react'] },
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default config;
