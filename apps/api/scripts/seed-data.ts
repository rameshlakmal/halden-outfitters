// The demo catalogue, accounts and addresses. Products, prices and specs are made up for this demo shop.

export type SeedProduct = {
  slug: string;
  sku: string;
  category: string;
  name: string;
  price: string;
  /** The old price, for sale items. */
  compareAt: string | null;
  stock: number;
  featured?: boolean;
  returnable: boolean;
  summary: string;
  description: string;
  details: Record<string, string>;
};

export const CATEGORIES = [
  {
    slug: 'shelter',
    name: 'Shelter',
    blurb: 'Tents, tarps and hammocks for a dry night anywhere.',
    image: '/images/products/ridgeline-2p-tent.jpg',
  },
  {
    slug: 'sleep',
    name: 'Sleep',
    blurb: 'Bags, pads and blankets that keep the cold out.',
    image: '/images/products/alpine-down-bag.jpg',
  },
  {
    slug: 'kitchen',
    name: 'Camp kitchen',
    blurb: 'Stoves, pots and mugs for hot food on the trail.',
    image: '/images/products/ember-stove.jpg',
  },
  {
    slug: 'carry',
    name: 'Packs and carry',
    blurb: 'Packs, dry bags and light for long days out.',
    image: '/images/products/summit-45l-pack.jpg',
  },
];

/** Water filters and pillows are hygiene items: final sale, not returnable. Three items are on sale. */
export const PRODUCTS: SeedProduct[] = [
  {
    slug: 'ridgeline-2p-tent',
    category: 'shelter',
    name: 'Ridgeline 2P Tent',
    price: '349.00',
    stock: 14,
    featured: true,
    summary: 'A freestanding two-person tent that pitches in four minutes.',
    description:
      'Two doors, two vestibules and a single hubbed pole that clips together in one piece. The fly pitches first in the rain, so the inner stays dry.',
    details: { Sleeps: '2 people', Weight: '1.9 kg', 'Packed size': '48 x 16 cm', Seasons: '3-season' },
    sku: 'HO-RIDGELINE2',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'trail-tarp',
    category: 'shelter',
    name: 'Trail Tarp',
    price: '89.00',
    stock: 22,
    summary: 'A silnylon tarp with twelve tie-outs for any pitch.',
    description:
      'Fly it high for a shaded camp kitchen or low as a storm shelter. Reinforced tie-outs take trekking poles or a ridgeline.',
    details: { Size: '3 x 3 m', Weight: '540 g', Fabric: '20D silnylon' },
    sku: 'HO-TRAILTARP',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'drift-hammock',
    category: 'shelter',
    name: 'Drift Hammock',
    price: '64.00',
    stock: 3,
    summary: 'A roomy single hammock with tree-friendly straps.',
    description:
      'Soft parachute nylon, wide enough to lie diagonally and flat. Straps and carabiners included, nothing else to buy.',
    details: { Length: '2.9 m', 'Holds up to': '140 kg', Weight: '620 g' },
    sku: 'HO-DRIFTHAMMO',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'fold-camp-chair',
    category: 'shelter',
    name: 'Fold Camp Chair',
    price: '59.00',
    stock: 30,
    summary: 'A low chair that folds to the size of a water bottle.',
    description:
      'Shock-corded aluminium frame and a breathable mesh seat. Sets up in under a minute and packs into its own sack.',
    details: { 'Seat height': '28 cm', 'Holds up to': '120 kg', Weight: '950 g' },
    sku: 'HO-FOLDCAMPCH',
    compareAt: '75.00',
    returnable: true,
  },
  {
    slug: 'alpine-down-bag',
    category: 'sleep',
    name: 'Alpine Down Bag',
    price: '279.00',
    stock: 9,
    featured: true,
    summary: 'A mummy bag filled with responsibly sourced 700-fill down.',
    description: 'Comfortable to minus 4 degrees, with a draft collar and a full-length zip that vents on warm nights.',
    details: { 'Comfort rating': '-4 °C', Fill: '700-fill duck down', Weight: '1.1 kg' },
    sku: 'HO-ALPINEDOWN',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'loft-sleeping-pad',
    category: 'sleep',
    name: 'Loft Sleeping Pad',
    price: '149.00',
    stock: 0,
    summary: 'An insulated air pad that packs smaller than a litre bottle.',
    description:
      'Seven centimetres of air with a reflective layer for cold ground. Inflates in about fifteen breaths with the included pump sack.',
    details: { 'R-value': '4.2', Thickness: '7 cm', Weight: '480 g' },
    sku: 'HO-LOFTSLEEPI',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'camp-pillow',
    category: 'sleep',
    name: 'Camp Pillow',
    price: '32.00',
    stock: 40,
    summary: 'An inflatable pillow with a soft brushed cover.',
    description: 'Curved to cradle your head and adjustable with a two-way valve. Packs to the size of a fist.',
    details: { Size: '38 x 28 cm', Weight: '95 g' },
    sku: 'HO-CAMPPILLOW',
    compareAt: null,
    returnable: false,
  },
  {
    slug: 'wool-camp-blanket',
    category: 'sleep',
    name: 'Wool Camp Blanket',
    price: '98.00',
    stock: 12,
    summary: 'A heavy wool blanket for cold evenings around the fire.',
    description: 'Woven from recycled wool with a blanket-stitched edge. Warm when damp and easy to brush clean.',
    details: { Size: '150 x 200 cm', Material: '80% recycled wool' },
    sku: 'HO-WOOLCAMPBL',
    compareAt: '120.00',
    returnable: true,
  },
  {
    slug: 'ember-stove',
    category: 'kitchen',
    name: 'Ember Stove',
    price: '69.00',
    stock: 25,
    featured: true,
    summary: 'A compact canister stove that boils a litre in three minutes.',
    description:
      'Folding pot supports, a wind-resistant burner and push-button ignition. Fits inside the Titanium Pot.',
    details: { Fuel: 'Isobutane canister', 'Boil time': '3 min / 1 L', Weight: '88 g' },
    sku: 'HO-EMBERSTOVE',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'titanium-pot',
    category: 'kitchen',
    name: 'Titanium Pot',
    price: '54.00',
    stock: 18,
    summary: 'A one-litre titanium pot with a strainer lid.',
    description: 'Light, strong and quick to heat. Folding handles lock in place and the lid doubles as a frying pan.',
    details: { Capacity: '1 L', Weight: '135 g', Material: 'Grade 1 titanium' },
    sku: 'HO-TITANIUMPO',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'insulated-mug',
    category: 'kitchen',
    name: 'Insulated Mug',
    price: '28.00',
    stock: 4,
    summary: 'A double-wall mug that keeps coffee hot for an hour.',
    description:
      'Stainless steel inside and out with a sliding lid that seals against splashes. Fits most cup holders.',
    details: { Capacity: '350 ml', Weight: '240 g' },
    sku: 'HO-INSULATEDM',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'water-filter',
    category: 'kitchen',
    name: 'Squeeze Water Filter',
    price: '42.00',
    stock: 33,
    summary: 'A hollow-fibre filter for clean water from streams and lakes.',
    description:
      'Screw it onto a soft bottle and drink straight through it, or squeeze into a pot. Backflushes clean with the syringe.',
    details: { Filters: 'Bacteria and protozoa', 'Flow rate': '1.7 L per minute', Weight: '85 g' },
    sku: 'HO-WATERFILTE',
    compareAt: null,
    returnable: false,
  },
  {
    slug: 'summit-45l-pack',
    category: 'carry',
    name: 'Summit 45L Pack',
    price: '229.00',
    stock: 11,
    featured: true,
    summary: 'A load-carrying pack for multi-day trips.',
    description:
      'An adjustable back panel, a padded hip belt with pockets, and a roll-top that grows when you need room for food.',
    details: { Volume: '45 L', 'Back length': 'Adjustable 40-52 cm', Weight: '1.4 kg' },
    sku: 'HO-SUMMIT45LP',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'daypack-22l',
    category: 'carry',
    name: 'Daypack 22L',
    price: '119.00',
    stock: 16,
    summary: 'A light daypack with a ventilated back.',
    description: 'Room for a layer, lunch and a water bladder. The stretch front pocket takes a wet jacket.',
    details: { Volume: '22 L', Weight: '650 g' },
    sku: 'HO-DAYPACK22L',
    compareAt: '139.00',
    returnable: true,
  },
  {
    slug: 'roll-top-dry-bag',
    category: 'carry',
    name: 'Roll-top Dry Bag',
    price: '34.00',
    stock: 50,
    summary: 'A waterproof bag that keeps a sleeping bag bone dry.',
    description: 'Welded seams and a three-roll closure. A D-ring lets you clip it to a pack or a boat.',
    details: { Volume: '20 L', Weight: '160 g' },
    sku: 'HO-ROLLTOPDRY',
    compareAt: null,
    returnable: true,
  },
  {
    slug: 'headlamp-400',
    category: 'carry',
    name: 'Headlamp 400',
    price: '45.00',
    stock: 27,
    summary: 'A rechargeable headlamp with a red night mode.',
    description: 'Four hundred lumens on high, and a red light that keeps your night vision. Charges over USB-C.',
    details: { Brightness: '400 lumens', 'Battery life': 'Up to 40 h on low', Weight: '78 g' },
    sku: 'HO-HEADLAMP40',
    compareAt: null,
    returnable: true,
  },
];

export const COUNTRIES: [code: string, name: string][] = [
  ['AT', 'Austria'],
  ['AU', 'Australia'],
  ['BE', 'Belgium'],
  ['CA', 'Canada'],
  ['CH', 'Switzerland'],
  ['CZ', 'Czechia'],
  ['DE', 'Germany'],
  ['DK', 'Denmark'],
  ['EE', 'Estonia'],
  ['ES', 'Spain'],
  ['FI', 'Finland'],
  ['FR', 'France'],
  ['GB', 'United Kingdom'],
  ['GR', 'Greece'],
  ['HR', 'Croatia'],
  ['HU', 'Hungary'],
  ['IE', 'Ireland'],
  ['IN', 'India'],
  ['IS', 'Iceland'],
  ['IT', 'Italy'],
  ['JP', 'Japan'],
  ['KR', 'South Korea'],
  ['LK', 'Sri Lanka'],
  ['LT', 'Lithuania'],
  ['LU', 'Luxembourg'],
  ['LV', 'Latvia'],
  ['MX', 'Mexico'],
  ['NL', 'Netherlands'],
  ['NO', 'Norway'],
  ['NZ', 'New Zealand'],
  ['PL', 'Poland'],
  ['PT', 'Portugal'],
  ['RO', 'Romania'],
  ['SE', 'Sweden'],
  ['SG', 'Singapore'],
  ['SI', 'Slovenia'],
  ['SK', 'Slovakia'],
  ['US', 'United States'],
  ['ZA', 'South Africa'],
];

export type SeedAccount = {
  email: string;
  name: string;
  role: 'customer' | 'support' | 'warehouse' | 'admin';
  staff: boolean;
};

/** Staff accounts use SEED_ADMIN_PASSWORD, shoppers SEED_SHOPPER_PASSWORD. All are verified demo accounts. */
export const ACCOUNTS: SeedAccount[] = [
  { email: 'admin@halden.test', name: 'Halden admin', role: 'admin', staff: true },
  { email: 'support@halden.test', name: 'Noor Haddad', role: 'support', staff: true },
  { email: 'warehouse@halden.test', name: 'Tomas Berg', role: 'warehouse', staff: true },
  { email: 'maya@halden.test', name: 'Maya Okafor', role: 'customer', staff: false },
  { email: 'jonas@halden.test', name: 'Jonas Lindqvist', role: 'customer', staff: false },
  { email: 'ari@halden.test', name: 'Ari Takahashi', role: 'customer', staff: false },
];

export const ADDRESSES: Record<
  string,
  { name: string; line1: string; city: string; region?: string; postcode: string; country: string }[]
> = {
  'maya@halden.test': [
    { name: 'Maya Okafor', line1: '14 Larch Street', city: 'Portland', region: 'OR', postcode: '97205', country: 'US' },
    { name: 'Maya Okafor', line1: '220 Alder Lane', city: 'Bend', region: 'OR', postcode: '97701', country: 'US' },
  ],
  'jonas@halden.test': [
    { name: 'Jonas Lindqvist', line1: 'Storgatan 8', city: 'Umea', postcode: '903 26', country: 'SE' },
  ],
  'ari@halden.test': [
    { name: 'Ari Takahashi', line1: '2-7-1 Asahi', city: 'Sapporo', postcode: '060-0042', country: 'JP' },
  ],
};

// ---------- phase 2: shipping, coupons, demo orders ----------

export const ZONES = [
  { code: 'domestic', name: 'United States' },
  { code: 'europe', name: 'Europe' },
  { code: 'world', name: 'Rest of the world' },
];

/** Europe for shipping: the EU plus the UK, Norway, Switzerland and Iceland. The US is domestic. */
export const EUROPE = new Set([
  'AT', 'BE', 'CH', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LT', 'LU', 'LV',
  'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);
export const zoneOf = (country: string) => (country === 'US' ? 'domestic' : EUROPE.has(country) ? 'europe' : 'world');

export const RATES = [
  { zone: 'domestic', method: 'standard', price: '7.95', freeFrom: '75.00', days: [2, 4] },
  { zone: 'domestic', method: 'express', price: '14.95', freeFrom: null, days: [1, 2] },
  { zone: 'europe', method: 'standard', price: '14.95', freeFrom: '150.00', days: [4, 7] },
  { zone: 'europe', method: 'express', price: '29.95', freeFrom: null, days: [2, 3] },
  { zone: 'world', method: 'standard', price: '24.95', freeFrom: null, days: [7, 14] },
] as const;

export type SeedCoupon = {
  code: string;
  kind: 'percent' | 'fixed' | 'free_shipping';
  value: string;
  minSubtotal?: string;
  maxUses?: number;
  perCustomer?: number;
  firstOrderOnly?: boolean;
  includeSaleItems?: boolean;
  endsAt?: string;
  active?: boolean;
  excludeCategories?: string[];
  description: string;
};

export const COUPONS: SeedCoupon[] = [
  { code: 'WELCOME10', kind: 'percent', value: '10', perCustomer: 1, firstOrderOnly: true, description: '10% off your first order' },
  { code: 'TRAILHEAD15', kind: 'percent', value: '15', minSubtotal: '100.00', maxUses: 3, description: '15% off orders of 100.00 or more; 3 uses (all used by the demo orders)' },
  { code: 'SAVE20', kind: 'fixed', value: '20.00', minSubtotal: '150.00', description: '20.00 off orders of 150.00 or more' },
  { code: 'FREESHIP', kind: 'free_shipping', value: '0', minSubtotal: '40.00', description: 'Free shipping, any method, on 40.00 or more' },
  { code: 'CAMP20', kind: 'percent', value: '20', excludeCategories: ['shelter'], description: '20% off everything except shelter' },
  { code: 'ALLIN25', kind: 'percent', value: '25', includeSaleItems: true, perCustomer: 2, description: '25% off, sale items included; twice per customer' },
  { code: 'SPRING5', kind: 'fixed', value: '5.00', endsAt: '2026-04-30T23:59:59Z', description: 'Expired at the end of April' },
  { code: 'STAFF50', kind: 'percent', value: '50', active: false, description: 'Switched off' },
];

export type SeedOrder = {
  email: string;
  daysAgo: number;
  items: [slug: string, qty: number][];
  coupon?: string;
  /** How far the order got. */
  status: 'confirmed' | 'packed' | 'shipped' | 'delivered' | 'cancelled';
  method?: 'standard' | 'express';
  card?: string;
};

export const DEMO_ORDERS: SeedOrder[] = [
  { email: 'maya@halden.test', daysAgo: 45, items: [['wool-camp-blanket', 1], ['camp-pillow', 2]], status: 'delivered' },
  { email: 'maya@halden.test', daysAgo: 12, items: [['ridgeline-2p-tent', 1], ['ember-stove', 1]], coupon: 'TRAILHEAD15', status: 'delivered' },
  { email: 'jonas@halden.test', daysAgo: 6, items: [['camp-pillow', 2], ['insulated-mug', 1]], status: 'delivered' },
  { email: 'ari@halden.test', daysAgo: 5, items: [['drift-hammock', 1]], status: 'cancelled' },
  { email: 'jonas@halden.test', daysAgo: 3, items: [['summit-45l-pack', 1], ['roll-top-dry-bag', 2]], coupon: 'TRAILHEAD15', status: 'shipped', method: 'express' },
  { email: 'maya@halden.test', daysAgo: 1, items: [['alpine-down-bag', 1]], coupon: 'TRAILHEAD15', status: 'packed' },
  { email: 'ari@halden.test', daysAgo: 0, items: [['headlamp-400', 1], ['water-filter', 1]], coupon: 'WELCOME10', status: 'confirmed' },
];
