// View-transition settings shared by the product card and the product page. The photo morphs only on
// navigations tagged nav-forward or nav-back, never on filter changes (those animate with Motion instead).
export const PRODUCT_MORPH = { 'nav-forward': 'morph', 'nav-back': 'morph', default: 'none' } as const;

/** Page content fades and rises in on tagged navigations; untagged ones (browser back, refresh) don't animate. */
export const PAGE_ENTER = { 'nav-forward': 'page', 'nav-back': 'page', default: 'none' } as const;
