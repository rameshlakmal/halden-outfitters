'use client';
// The admin frame: the grouped sidebar on wide screens (a slide-in menu on phones), the top bar with search,
// theme and account, and the gate. Signed out goes to sign-in; a customer account sees that this is for staff.
import { List, MagnifyingGlass, Moon, SignOut, Sun, X } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { isStaff, ROLE_LABEL, useSession } from '@/lib/staff';
import { Button, Skeleton } from '../kit';
import { CommandPalette, useCommandPalette } from './command';
import { Logo, SideNav } from './sidebar';
import { useTheme } from './theme';

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { theme, toggle } = useTheme();
  const palette = useCommandPalette();
  const [menu, setMenu] = useState(false);
  const me = session.data;

  useEffect(() => {
    if (session.isSuccess && !me) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [session.isSuccess, me, router, pathname]);

  const signOut = async () => {
    await post('/auth/logout').catch(() => {});
    qc.clear();
    router.replace('/sign-in');
  };

  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Skeleton className="h-10 w-48" />
      </div>
    );
  }
  if (!isStaff(me.role)) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <div className="grid max-w-md justify-items-start gap-4">
          <Logo />
          <h1 className="text-2xl font-semibold">This is the staff admin</h1>
          <p className="text-ink-2">
            You are signed in as {me.email}, a customer account. Sign in with a support, warehouse or admin account to
            use it.
          </p>
          <Button variant="secondary" onClick={signOut}>
            <SignOut className="size-4" /> Sign out
          </Button>
        </div>
      </div>
    );
  }

  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-30 hidden h-dvh overflow-y-auto border-r border-line bg-surface px-3.5 py-4 lg:block">
        <div className="pb-3">
          <Logo />
        </div>
        <SideNav role={me.role} />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-8">
          <Dialog.Root open={menu} onOpenChange={setMenu}>
            <Dialog.Trigger asChild>
              <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open the menu">
                <List className="size-5" />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-[280px] overflow-y-auto bg-surface px-3.5 py-4 shadow-[var(--shadow-pop)]">
                <div className="flex items-center pb-3">
                  <Logo />
                  <Dialog.Close asChild>
                    <Button variant="ghost" size="sm" className="ml-auto" aria-label="Close the menu">
                      <X className="size-5" />
                    </Button>
                  </Dialog.Close>
                </div>
                <Dialog.Title className="sr-only">Sections</Dialog.Title>
                <SideNav role={me.role} onNavigate={() => setMenu(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-full border border-line bg-bg px-4 text-left text-sm text-ink-3 sm:max-w-[520px]"
          >
            <MagnifyingGlass className="size-[18px] shrink-0" />
            <span className="truncate">Search sections and orders</span>
            <kbd className="tabular ml-auto hidden rounded-md border border-line px-1.5 text-[11.5px] text-ink-2 sm:block">
              Ctrl K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'}
            >
              <ThemeIcon className="size-4" />
            </Button>
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{me.name}</p>
              <p className="text-xs text-ink-3">{ROLE_LABEL[me.role]}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
              <SignOut className="size-[18px]" />
            </Button>
          </div>
        </header>

        <main id="main" className="grid gap-4 px-4 py-6 sm:px-8">
          {children}
        </main>
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        role={me.role}
        onToggleTheme={toggle}
        onSignOut={signOut}
      />
    </div>
  );
}
