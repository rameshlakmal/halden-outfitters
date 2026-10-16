'use client';
// The cart drawer: a native <dialog> (focus trap, Escape, inert page for free) that slides in with
// @starting-style. Its contents are a separate chunk, loaded on first use.
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

type Ctx = { open: () => void; close: () => void };
const DrawerContext = createContext<Ctx>({ open: () => {}, close: () => {} });
export const useCartDrawer = () => useContext(DrawerContext);

const loadBody = () => import('./drawer-body');
const DrawerBody = lazy(loadBody);
/** Starts downloading the drawer's code early (pointer near the cart button, or a product being added). */
export const preloadCartDrawer = () => void loadBody();

export function CartDrawerProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => {
    if (!ref.current?.open) ref.current?.showModal();
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    ref.current?.close();
    setOpen(false);
  }, []);
  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <DrawerContext.Provider value={value}>
      {children}
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === ref.current && close()}
        aria-label="Your cart"
        className="drawer fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-[420px] bg-surface p-0 text-ink shadow-[var(--shadow-lift)] sm:rounded-l-[16px]"
      >
        {isOpen && (
          <Suspense fallback={<div className="skeleton h-full" aria-busy="true" />}>
            <DrawerBody onClose={close} />
          </Suspense>
        )}
      </dialog>
    </DrawerContext.Provider>
  );
}
