'use client';
// Client-side context for the whole app: server state (TanStack Query), toasts and the cart drawer.
// Animation needs no provider: it's CSS and browser APIs (see lib/motion.ts).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ToastProvider } from './ui/toast';
import { CartDrawerProvider } from './shell/cart-drawer';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: true },
          mutations: { retry: 0 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <CartDrawerProvider>{children}</CartDrawerProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
