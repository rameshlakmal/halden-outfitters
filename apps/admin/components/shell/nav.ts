import {
  ArrowUUpLeft,
  ChartLineUp,
  ChatCircleText,
  ClipboardText,
  Flask,
  GearSix,
  Package,
  Tag,
  Ticket,
  Truck,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import type { DashboardData, Section } from '@/lib/staff';

export type NavItem = {
  section: Section;
  href: string;
  label: string;
  icon: Icon;
  /** Open work shown as a counter next to the item. */
  count?: (q: DashboardData['queues']) => number;
};

export const NAV: { group: string | null; items: NavItem[] }[] = [
  { group: null, items: [{ section: 'dashboard', href: '/', label: 'Dashboard', icon: ChartLineUp }] },
  {
    group: 'Operations',
    items: [
      { section: 'orders', href: '/orders', label: 'Orders', icon: Package },
      { section: 'warehouse', href: '/warehouse', label: 'Warehouse', icon: Truck, count: (q) => q.toPack + q.toShip },
      {
        section: 'returns',
        href: '/returns',
        label: 'Returns',
        icon: ArrowUUpLeft,
        count: (q) => q.returnsToDecide + q.returnsToReceive,
      },
      {
        section: 'reviews',
        href: '/reviews',
        label: 'Reviews',
        icon: ChatCircleText,
        count: (q) => q.reviewsToModerate,
      },
    ],
  },
  {
    group: 'Catalogue',
    items: [
      { section: 'products', href: '/products', label: 'Products', icon: Tag, count: (q) => q.lowStock },
      { section: 'coupons', href: '/coupons', label: 'Coupons', icon: Ticket },
    ],
  },
  {
    group: 'Admin',
    items: [
      { section: 'customers', href: '/customers', label: 'Customers', icon: UsersThree },
      { section: 'settings', href: '/settings', label: 'Settings', icon: GearSix },
      { section: 'audit', href: '/audit', label: 'Audit log', icon: ClipboardText },
      { section: 'qa', href: '/qa', label: 'QA lab', icon: Flask },
    ],
  },
];

export const isActive = (href: string, pathname: string) =>
  href === '/' ? pathname === '/' : pathname.startsWith(href);
