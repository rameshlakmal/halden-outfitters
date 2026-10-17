/** The staff admin, its own app (apps/admin). Set at build time. */
export const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3002').replace(/\/$/, '');
