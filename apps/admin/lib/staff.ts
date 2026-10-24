'use client';
// Who may open which section, the session, and the query keys. Type-only imports from the contracts, so no
// validation code is shipped to the browser. Who may see what mirrors DESIGN.md 3.10; the API checks every action.
import type { Dashboard, Me, Role } from '@halden/contracts';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { get } from './api';

export type DashboardData = z.infer<typeof Dashboard>;

export const keys = {
  session: ['session'] as const,
  dashboard: (days: number) => ['dashboard', days] as const,
};

export type Section =
  | 'dashboard'
  | 'orders'
  | 'warehouse'
  | 'returns'
  | 'reviews'
  | 'products'
  | 'coupons'
  | 'banners'
  | 'customers'
  | 'settings'
  | 'audit'
  | 'qa';

const ALL_STAFF: Role[] = ['support', 'warehouse', 'admin'];

// The viewer is the public read-only demo login: only the sections that show no customer's details.
export const SECTION_ROLES: Record<Section, Role[]> = {
  dashboard: [...ALL_STAFF, 'viewer'],
  orders: ALL_STAFF,
  warehouse: ['warehouse', 'admin'],
  returns: ALL_STAFF,
  reviews: ['support', 'admin'],
  products: [...ALL_STAFF, 'viewer'],
  coupons: ['admin', 'viewer'],
  banners: ['admin'],
  customers: ['support', 'admin'],
  settings: ['admin', 'viewer'],
  audit: ['admin'],
  qa: ['admin', 'viewer'],
};

/** May open the admin at all: every staff role and the viewer. */
export const isStaff = (role: Role | undefined) => !!role && (ALL_STAFF.includes(role) || role === 'viewer');
export const can = (role: Role | undefined, section: Section) => !!role && SECTION_ROLES[section].includes(role);

export const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  support: 'Support',
  warehouse: 'Warehouse',
  admin: 'Admin',
  viewer: 'Viewer (read-only)',
};

/** The signed-in account, or null. */
export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: () => get<{ customer: Me | null }>('/auth/session').then((r) => r.customer),
    staleTime: 60_000,
  });
}

export function useDashboard(days: number, enabled = true) {
  return useQuery({
    queryKey: keys.dashboard(days),
    queryFn: () => get<DashboardData>(`/staff/dashboard?days=${days}`),
    enabled,
    refetchInterval: 60_000,
  });
}
