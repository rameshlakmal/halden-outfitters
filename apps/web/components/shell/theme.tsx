'use client';
import { Desktop, Moon, Sun } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';

type Theme = 'system' | 'light' | 'dark';
import { THEME_KEY as KEY } from '@/lib/boot-script';

const listeners = new Set<() => void>();
function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}
function write(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  listeners.forEach((l) => l());
}

const ORDER: Theme[] = ['system', 'light', 'dark'];
const LABEL: Record<Theme, string> = { system: 'Theme: match device', light: 'Theme: light', dark: 'Theme: dark' };

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => 'system' as Theme,
  );
  const nextTheme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Desktop;
  return (
    <button
      type="button"
      onClick={() => write(nextTheme)}
      className="press grid size-10 place-items-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={`${LABEL[theme]}. Switch to ${nextTheme === 'system' ? 'match device' : nextTheme}.`}
      title={LABEL[theme]}
    >
      <Icon className="size-5" />
    </button>
  );
}
