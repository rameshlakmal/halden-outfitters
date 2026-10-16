'use client';
import type { Me } from '@halden/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/lib/queries';

/**
 * The signed-in customer for account pages. The proxy only checks that a cookie exists; when the session behind
 * it has ended (signed out elsewhere, expired), this sends the visitor to sign in and back.
 */
export function useAccount(): { me: Me | null; loading: boolean } {
  const { data, isPending } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!isPending && data === null) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [isPending, data, router, pathname]);
  return { me: data ?? null, loading: isPending || data === null };
}
