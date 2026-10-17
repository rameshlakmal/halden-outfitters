'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { THEME_KEY } from '@/lib/theme';

type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();
const current = (): Theme => {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** The theme in use (saved choice, else the system's), and a toggle that remembers the choice. */
export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const mq = matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', cb);
      return () => {
        listeners.delete(cb);
        mq.removeEventListener('change', cb);
      };
    },
    current,
    () => 'light' as Theme,
  );
  const toggle = useCallback(() => {
    const next: Theme = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    listeners.forEach((l) => l());
  }, []);
  return { theme, toggle };
}
