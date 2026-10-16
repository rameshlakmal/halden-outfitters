'use client';
// Preview tool: switches the colour palette live. The choice is remembered in this browser and applied
// before the first paint (see lib/boot-script.ts), so a reload doesn't flash the default colours.
import { CaretDown, Palette as PaletteIcon } from '@phosphor-icons/react';
import { useEffect, useSyncExternalStore } from 'react';
import { PALETTE_KEY, PALETTES } from '@/lib/palettes';

const listeners = new Set<() => void>();
const read = () => document.documentElement.dataset.palette ?? 'signal';

function choose(id: string) {
  if (id === 'signal') delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = id;
  try {
    localStorage.setItem(PALETTE_KEY, id);
  } catch {
    /* private mode: lasts for this page only */
  }
  listeners.forEach((l) => l());
}

export function PaletteSwitcher() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => 'signal',
  );
  // Re-read once mounted: the server always renders the default, and the stored choice must win.
  useEffect(() => listeners.forEach((l) => l()), []);
  const palette = PALETTES.find((p) => p.id === current) ?? PALETTES[0]!;

  return (
    <div className="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-[2px] border border-line-strong bg-surface py-2 pr-2 pl-3 text-ink shadow-[var(--shadow-lift)]">
      <PaletteIcon className="size-5 shrink-0 text-accent" weight="fill" />
      <span className="flex gap-1" aria-hidden="true">
        {palette.swatch.map((c) => (
          <span key={c} className="size-4 rounded-[2px] border border-line" style={{ background: c }} />
        ))}
      </span>
      <label className="relative flex items-center">
        <span className="sr-only">Colour palette</span>
        <select
          value={current}
          onChange={(e) => choose(e.target.value)}
          className="h-9 cursor-pointer appearance-none rounded-[2px] border border-line bg-surface-2 pr-8 pl-3 text-sm font-semibold outline-none hover:border-ink-3"
        >
          {PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <CaretDown className="pointer-events-none absolute right-2.5 size-4 text-ink-3" />
      </label>
    </div>
  );
}
