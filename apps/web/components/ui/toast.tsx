'use client';
// Toasts are for short-lived news only ("Added to cart"). Form problems are shown inline instead.
// They rise in with @starting-style and fade out with a CSS transition before being removed.
import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

type Toast = { id: number; tone: 'success' | 'error'; message: string; leaving: boolean };
type Ctx = { show: (message: string, tone?: Toast['tone']) => void };

const ToastContext = createContext<Ctx>({ show: () => {} });
export const useToast = () => useContext(ToastContext);

const LEAVE_MS = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), LEAVE_MS);
  }, []);
  const show = useCallback(
    (message: string, tone: Toast['tone'] = 'success') => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-2), { id, tone, message, leaving: false }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`enter glass pointer-events-auto flex max-w-md items-center gap-3 rounded-full border border-line py-2.5 pr-2.5 pl-4 text-sm text-ink shadow-[var(--shadow-lift)] transition-[opacity,transform] duration-200 ${
              t.leaving ? 'translate-y-2 opacity-0' : ''
            }`}
          >
            {t.tone === 'success' ? (
              <CheckCircle weight="fill" className="size-5 shrink-0 text-brand" />
            ) : (
              <WarningCircle weight="fill" className="size-5 shrink-0 text-danger" />
            )}
            <span>{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="press grid size-7 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
