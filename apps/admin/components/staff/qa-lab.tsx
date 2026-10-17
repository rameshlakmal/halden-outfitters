'use client';
// The QA lab: switch planted bugs on and off, move the shop clock, run the time-based rules now, and replay
// payment webhooks. Each bug breaks exactly one rule in qa/rules.sql.
import { SHOP_URL } from '@/lib/shop';
import { ArrowClockwise, EnvelopeSimple } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { post, put } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type Bug, type ClockState, staffKeys, type SweepResult, useBugs, useClock, useWebhooks } from './api';
import { EmptyRow, ErrorBox, ErrorRow, inputClass, PageHead, Panel, RowLink, SkeletonRows, Table, Td, Th } from './ui';

const PHASE_LABEL: Record<number, string> = {
  2: 'Checkout and orders',
  3: 'Returns, refunds and points',
  4: 'Reviews and staff',
};

export function QaLab() {
  return (
    <>
      <PageHead
        title="QA lab"
        sub="Every bug is off until you switch it on. Each one breaks exactly one rule in qa/rules.sql."
        actions={
          <a
            href={`${SHOP_URL}/qa/inbox`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 text-[13px] font-medium transition-colors hover:text-accent-text pointer-coarse:min-h-11"
          >
            <EnvelopeSimple className="size-4" /> Fake inbox (in the shop)
          </a>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Bugs />
        <div className="grid content-start gap-5">
          <ClockPanel />
          <Sweeps />
        </div>
      </div>
      <Webhooks />
    </>
  );
}

function Bugs() {
  const q = useBugs();
  if (q.isPending) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const phases = [...new Set(q.data.items.map((b) => b.phase))].sort();
  const on = q.data.items.filter((b) => b.enabled).length;
  return (
    <section className="grid min-w-0 content-start gap-4" aria-labelledby="bugs">
      <h2 id="bugs" className="flex items-baseline gap-2 text-[22px]">
        Planted bugs <span className="text-[14px] font-semibold text-ink-3">{on} on</span>
      </h2>
      {phases.map((phase) => (
        <div key={phase} className="grid gap-2">
          <h3 className="text-[13px] font-bold text-ink-2">
            Phase {phase}: {PHASE_LABEL[phase] ?? ''}
          </h3>
          <ul className="grid divide-y divide-line rounded-[var(--radius-field)] border border-line">
            {q.data.items
              .filter((b) => b.phase === phase)
              .map((b) => (
                <BugRow key={b.key} bug={b} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function BugRow({ bug: b }: { bug: Bug }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const setBug = (next: Bug) =>
    qc.setQueryData<{ items: Bug[] }>(
      staffKeys.bugs,
      (old) => old && { items: old.items.map((x) => (x.key === b.key ? next : x)) },
    );
  const toggle = async () => {
    const before = b;
    // Flip at once, so the switch answers the click; put it back if the API refuses. A list refresh already on its
    // way would overwrite the flip with the old value, so cancel it first.
    await qc.cancelQueries({ queryKey: staffKeys.bugs });
    setBug({ ...b, enabled: !b.enabled });
    setBusy(true);
    try {
      const updated = await put<Bug>(`/qa/bugs/${b.key}`, { enabled: !before.enabled });
      setBug(updated);
      toast.show(`${b.title}: ${updated.enabled ? 'on' : 'off'}`);
    } catch (err) {
      setBug(before);
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`grid gap-1.5 p-3 ${b.enabled ? 'bg-danger-soft' : ''}`} data-testid={`bug-${b.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <p className="font-semibold">{b.title}</p>
          <p className="font-mono text-[11px] text-ink-3">{b.key}</p>
        </div>
        <label className="flex min-h-9 shrink-0 cursor-pointer items-center gap-2 text-[13px] font-medium pointer-coarse:min-h-11">
          <span className={b.enabled ? 'text-danger' : 'text-ink-3'}>{b.enabled ? 'On' : 'Off'}</span>
          <input
            type="checkbox"
            role="switch"
            checked={b.enabled}
            disabled={busy}
            onChange={() => void toggle()}
            className="size-5 accent-[var(--accent)]"
            aria-label={`${b.title} ${b.enabled ? 'on' : 'off'}`}
          />
        </label>
      </div>
      <p className="text-[13px] text-ink-2">{b.description}</p>
      <p className="text-[13px]">
        <span className="font-semibold">How to see it: </span>
        <span className="text-ink-2">{b.howToSee}</span>
      </p>
      <p className="text-[13px]">
        <span className="font-semibold">Rule it breaks: </span>
        <span className="text-ink-2">{b.rule}</span>
      </p>
    </li>
  );
}

const STEPS: { label: string; seconds: number }[] = [
  { label: '+30 min', seconds: 30 * 60 },
  { label: '+1 day', seconds: 86400 },
  { label: '+14 days', seconds: 14 * 86400 },
  { label: '+31 days', seconds: 31 * 86400 },
];

const offsetText = (s: number) => {
  if (s === 0) return 'Real time';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${[d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || `${s}s`} ahead`;
};

function ClockPanel() {
  const q = useClock();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);

  const setOffset = async (offsetSeconds: number) => {
    setBusy(true);
    setError(null);
    try {
      const c = await put<ClockState>('/qa/clock', { offsetSeconds });
      qc.setQueryData(staffKeys.clock, c);
      // Everything time-based may read differently now.
      void qc.invalidateQueries({ queryKey: ['staff'] });
      toast.show(`Shop clock: ${offsetText(c.offsetSeconds)}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const custom = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(days);
    if (!(n > 0) || n > 400) return setError('Days ahead from now: more than 0, up to 400.');
    void setOffset((q.data?.offsetSeconds ?? 0) + Math.round(n * 86400));
    setDays('');
  };

  return (
    <Panel
      title="Shop clock"
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void q.refetch()}
          aria-label="Refresh the clock"
          icon={<ArrowClockwise className="size-4" />}
        >
          Refresh
        </Button>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-12 w-full" />
      ) : q.isError ? (
        <ErrorBox error={q.error} retry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-0.5">
          <p className="text-[22px] font-bold tabular-nums" data-testid="shop-now">
            {formatDateTime(q.data.now)}
          </p>
          <p className="text-[13px] text-ink-2">{offsetText(q.data.offsetSeconds)}</p>
        </div>
      )}
      <p className="text-[13px] text-ink-3">
        The clock only moves forward. Timed rules (payment timeout, return window, labels, points) follow it.
      </p>
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => (
          <Button
            key={s.label}
            size="sm"
            variant="outline"
            disabled={busy || !q.data}
            onClick={() => void setOffset((q.data?.offsetSeconds ?? 0) + s.seconds)}
          >
            {s.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy || !q.data?.offsetSeconds} onClick={() => void setOffset(0)}>
          Reset
        </Button>
      </div>
      <form onSubmit={custom} className="flex items-end gap-2">
        <label className="grid flex-1 gap-1.5 text-[13px] font-medium">
          Days ahead
          <input
            className={inputClass}
            inputMode="decimal"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="e.g. 7"
          />
        </label>
        <Button type="submit" size="sm" busy={busy}>
          Move
        </Button>
      </form>
      {error && <FormAlert>{error}</FormAlert>}
    </Panel>
  );
}

function Sweeps() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await post<SweepResult>('/qa/sweeps'));
      void qc.invalidateQueries({ queryKey: ['staff'] });
      void qc.invalidateQueries({ queryKey: ['qa', 'webhooks'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Sweeps">
      <p className="text-[13px] text-ink-2">
        The live site runs these once a day. Run them now after moving the clock: unpaid orders time out, unused return
        labels expire, orders past their return window complete, 12-month-old points expire and queued webhooks are
        delivered.
      </p>
      <div>
        <Button size="sm" busy={busy} onClick={() => void run()}>
          Run sweeps now
        </Button>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
      {result && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-[13px]" data-testid="sweep-result">
          {(
            [
              ['Unpaid orders cancelled', result.expired],
              ['Orders completed', result.completed],
              ['Return labels expired', result.returnsExpired],
              ['Points expired', result.pointsExpired],
              ['Webhooks delivered', result.webhooksDelivered],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-2">{k}</dt>
              <dd className="text-right font-bold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function Webhooks() {
  const [draft, setDraft] = useState('');
  const [orderId, setOrderId] = useState('');
  const q = useWebhooks(orderId);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const redeliver = async (id: string) => {
    setBusy(id);
    try {
      const r = await post<{ delivered: number }>(`/qa/webhooks/${id}/redeliver`);
      toast.show(`Sent again (${r.delivered} delivered). A repeat should change nothing.`);
      void qc.invalidateQueries({ queryKey: ['qa', 'webhooks'] });
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="webhooks">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="webhooks" className="text-[22px]">
          Payment webhooks
        </h2>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setOrderId(/^\d+$/.test(draft.trim()) ? draft.trim() : '');
          }}
        >
          <label className="grid gap-1.5 text-[13px] font-medium">
            Order
            <input
              className={`${inputClass} w-32`}
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Any"
            />
          </label>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </div>
      <Table label="Payment webhooks">
        <thead>
          <tr>
            <Th>Created</Th>
            <Th>Event</Th>
            <Th>Order</Th>
            <Th className="text-right">Attempts</Th>
            <Th>Delivered</Th>
            <Th>Shop</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={7} rows={4} />
          ) : q.isError ? (
            <ErrorRow cols={7} error={q.error} retry={() => void q.refetch()} />
          ) : q.data.items.length === 0 ? (
            <EmptyRow cols={7}>
              No webhook events{orderId ? ` for order #${orderId}` : ''}. Placing an order creates some.
            </EmptyRow>
          ) : (
            q.data.items.map((e) => (
              <tr key={e.id} className="hover:bg-surface-2">
                <Td className="whitespace-nowrap text-ink-2">{formatDateTime(e.createdAt)}</Td>
                <Td>
                  <span className="font-semibold">{e.type}</span>
                  <span className="block font-mono text-[11px] text-ink-3">{e.id}</span>
                </Td>
                <Td>{e.orderId ? <RowLink href={`/orders/${e.orderId}`}>#{e.orderId}</RowLink> : ''}</Td>
                <Td className="text-right tabular-nums">{e.attempts}</Td>
                <Td className="whitespace-nowrap">
                  {e.deliveredAt ? formatDateTime(e.deliveredAt) : <span className="text-ink-3">Queued</span>}
                </Td>
                <Td>{e.processed ? 'Recorded' : <span className="text-ink-3">Not yet</span>}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" busy={busy === e.id} onClick={() => void redeliver(e.id)}>
                    Send again
                  </Button>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </section>
  );
}
