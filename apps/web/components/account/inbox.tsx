'use client';
import { Email, type InboxEmail } from '@halden/contracts';
import { ArrowClockwise, EnvelopeOpen, EnvelopeSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';
import { get } from '@/lib/api';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert, Input } from '../ui/field';
import { errorMessage } from './forms';

const LINK = /(https?:\/\/[^\s]+)/g;

/** The email body as text, with every link clickable. */
function Body({ text }: { text: string }) {
  return (
    <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-ink-2">
      {text.split(LINK).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} className="font-medium break-all text-forest underline">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

export function Inbox() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const email = params.get('email') ?? '';
  const [draft, setDraft] = useState(email);
  const [formError, setFormError] = useState<string | undefined>();
  const [openId, setOpenId] = useState<string | null>(null);

  const inbox = useQuery({
    queryKey: ['inbox', email],
    queryFn: () => get<{ items: InboxEmail[] }>(`/qa/inbox?email=${encodeURIComponent(email)}`),
    enabled: email !== '',
    refetchInterval: 10_000,
  });
  const items = inbox.data?.items ?? [];
  const shown = openId ?? items[0]?.id ?? null;

  return (
    <div className="grid gap-8">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = Email.safeParse(draft);
          if (!parsed.success) return setFormError(parsed.error.issues[0]?.message ?? 'Enter an email address.');
          setFormError(undefined);
          setOpenId(null);
          router.replace(`${pathname}?email=${encodeURIComponent(parsed.data)}`);
        }}
        className="grid max-w-xl gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
      >
        <Input
          label="Email address"
          type="email"
          inputMode="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="you@example.com"
          error={formError}
        />
        <Button type="submit" icon={<MagnifyingGlass className="size-[18px]" />}>
          Open inbox
        </Button>
      </form>

      {email === '' ? (
        <Empty title="Type an address to read its mail" text="Use any address you registered with on this demo shop." />
      ) : inbox.isPending ? (
        <div className="grid gap-3 md:grid-cols-[320px_1fr]">
          <Skeleton className="h-64 rounded-[16px]" />
          <Skeleton className="h-64 rounded-[16px]" />
        </div>
      ) : inbox.isError ? (
        <FormAlert>{errorMessage(inbox.error)}</FormAlert>
      ) : items.length === 0 ? (
        <Empty
          title={`No mail for ${email}`}
          text="Nothing has been sent to this address yet. Mail to the seeded demo accounts is only shown to admins, so nobody can reset their passwords."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[320px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-sm text-ink-3">
                {items.length} email{items.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                onClick={() => inbox.refetch()}
                className="press inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-ink-2 hover:bg-surface-2"
              >
                <ArrowClockwise className={`size-4 ${inbox.isFetching ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
            <ul className="grid gap-1">
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(m.id)}
                    aria-current={shown === m.id ? 'true' : undefined}
                    className={`grid w-full gap-0.5 rounded-[12px] px-4 py-3 text-left transition-colors ${
                      shown === m.id ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[15px] font-medium">
                      {shown === m.id ? (
                        <EnvelopeOpen className="size-4 shrink-0 text-forest" />
                      ) : (
                        <EnvelopeSimple className="size-4 shrink-0 text-ink-3" />
                      )}
                      <span className="truncate">{m.subject}</span>
                    </span>
                    <span className="pl-6 text-[13px] text-ink-3 tabular-nums">{when(m.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {items
            .filter((m) => m.id === shown)
            .map((m) => (
              <article key={m.id} className="grid content-start gap-4 rounded-[16px] border border-line bg-surface p-6">
                <header className="grid gap-1 border-b border-line pb-4">
                  <h2 className="text-lg font-semibold">{m.subject}</h2>
                  <p className="text-sm text-ink-3">
                    To {m.to}, {when(m.createdAt)}
                  </p>
                </header>
                <Body text={m.body} />
              </article>
            ))}
        </div>
      )}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-[16px] border border-dashed border-line-strong px-6 py-10">
      <EnvelopeSimple className="size-8 text-ink-3" weight="thin" />
      <p className="font-medium">{title}</p>
      <p className="max-w-[56ch] text-sm leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}
