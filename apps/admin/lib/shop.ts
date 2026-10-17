/** The shop's own site, for links that open a shop page (a product, the fake inbox). Set at build time. */
export const SHOP_URL = (process.env.NEXT_PUBLIC_SHOP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
