'use client';
// A themed dropdown for short option lists (sort, price band). Native <select> popups ignore the site's
// styling, so this renders its own list, with the ARIA listbox pattern and full keyboard support:
// arrows, Home/End, type-ahead, Enter or Space to pick, Escape or Tab to close.
import { CaretDown, Check } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

export type ListboxOption = { value: string; label: string };

export function Listbox({
  label,
  value,
  options,
  onChange,
  align = 'left',
}: {
  label: string;
  value: string;
  options: ListboxOption[];
  onChange: (value: string) => void;
  align?: 'left' | 'right';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  // Close when the pointer goes down anywhere else.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    setOpen(false);
    root.current?.querySelector('button')?.focus();
    if (o && o.value !== value) onChange(o.value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(a + 1, last)),
      ArrowUp: () => setActive((a) => Math.max(a - 1, 0)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => pick(active),
      ' ': () => pick(active),
      Escape: () => {
        setOpen(false);
        root.current?.querySelector('button')?.focus();
      },
      Tab: () => setOpen(false),
    };
    const action = keys[e.key];
    if (action) {
      if (e.key !== 'Tab') e.preventDefault();
      action();
      return;
    }
    // Type-ahead: jump to the first option starting with what was typed in the last half second.
    if (e.key.length === 1) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 500 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            show();
          }
        }}
        className={`press inline-flex h-10 items-center gap-2 rounded-[2px] border px-3.5 text-sm ${
          open ? 'border-ink bg-ink text-bg' : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
        }`}
      >
        <span className={`text-[12px] font-bold tracking-[0.08em] uppercase ${open ? 'opacity-70' : 'text-ink-3'}`}>
          {label}
        </span>
        <span className="font-semibold">{options[selected]?.label}</span>
        <CaretDown
          weight="bold"
          className={`size-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onKey}
          className={`enter absolute top-[calc(100%+6px)] z-40 min-w-full overflow-hidden rounded-[2px] border border-line-strong bg-surface py-1 shadow-[6px_6px_0_var(--line-strong)] outline-none ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === selected}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={`flex cursor-pointer items-center justify-between gap-6 border-l-[3px] px-3.5 py-2.5 text-sm whitespace-nowrap ${
                i === active ? 'border-accent bg-surface-2' : 'border-transparent'
              } ${i === selected ? 'font-bold' : ''}`}
            >
              {o.label}
              {i === selected && <Check weight="bold" className="size-4 text-accent" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
