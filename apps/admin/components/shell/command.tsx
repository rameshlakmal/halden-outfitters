'use client';
// Ctrl+K (Cmd+K on a Mac): jump to any section, open an order by its number, switch the theme, sign out.
import type { Role } from '@halden/contracts';
import { MagnifyingGlass, Moon, Package, SignOut } from '@phosphor-icons/react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { can } from '@/lib/staff';
import { NAV } from './nav';

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({
  open,
  onOpenChange,
  role,
  onToggleTheme,
  onSignOut,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: Role;
  onToggleTheme: () => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const orderNo = /^#?(\d{4,9})$/.exec(search.trim())?.[1];
  const go = (href: string) => {
    onOpenChange(false);
    setSearch('');
    router.push(href);
  };
  const item =
    'flex cursor-pointer items-center gap-3 rounded-[var(--radius-field)] px-3 py-2.5 text-sm text-ink-2 data-[selected=true]:bg-brand-soft data-[selected=true]:text-accent';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Search the admin"
      overlayClassName="fixed inset-0 z-50 bg-scrim"
      contentClassName="fixed top-[12vh] left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-pop)]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <MagnifyingGlass className="size-5 text-ink-3" />
        <Command.Input
          value={search}
          onValueChange={setSearch}
          placeholder="Go to a section, or type an order number"
          className="h-13 w-full bg-transparent text-[15px] outline-none placeholder:text-ink-3"
        />
      </div>
      <Command.List className="max-h-[360px] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">Nothing matches.</Command.Empty>
        {orderNo && can(role, 'orders') && (
          <Command.Group
            heading="Orders"
            className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
          >
            <Command.Item value={`order ${orderNo}`} onSelect={() => go(`/orders/${orderNo}`)} className={item}>
              <Package className="size-[18px]" /> Open order #{orderNo}
            </Command.Item>
          </Command.Group>
        )}
        <Command.Group
          heading="Go to"
          className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
        >
          {NAV.flatMap((g) => g.items)
            .filter((i) => can(role, i.section))
            .map((i) => (
              <Command.Item key={i.href} value={i.label} onSelect={() => go(i.href)} className={item}>
                <i.icon className="size-[18px]" /> {i.label}
              </Command.Item>
            ))}
        </Command.Group>
        <Command.Group
          heading="Actions"
          className="text-xs text-ink-3 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5"
        >
          <Command.Item
            value="Switch light or dark mode"
            onSelect={() => {
              onToggleTheme();
              onOpenChange(false);
            }}
            className={item}
          >
            <Moon className="size-[18px]" /> Switch light or dark mode
          </Command.Item>
          <Command.Item value="Sign out" onSelect={onSignOut} className={item}>
            <SignOut className="size-[18px]" /> Sign out
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
