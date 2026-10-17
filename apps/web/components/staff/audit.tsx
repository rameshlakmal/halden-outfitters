'use client';
// The audit log: every staff action, who did it, the record before and after, and the request it came from.
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Fragment, useState } from 'react';
import { formatDateTime } from '@/lib/orders';
import { Button } from '../ui/button';
import { type Audit, ROLE_LABEL, useAudit } from './api';
import { EmptyRow, ErrorRow, inputClass, LoadMore, PageHead, RowLink, SkeletonRows, Table, Td, Th } from './ui';

const TYPES = ['', 'order', 'return', 'product', 'review', 'coupon', 'shipping_rate', 'setting', 'customer', 'qa_bug'];

/** Where an entry's record lives in the console, when it has a page. */
function entityHref(a: Audit): string | null {
  if (a.entityType === 'order') return `/staff/orders/${a.entityId}`;
  if (a.entityType === 'return') return `/staff/returns/${a.entityId}`;
  if (a.entityType === 'product') return `/staff/products/${a.entityId}`;
  return null;
}

export function AuditLog() {
  const params = useSearchParams();
  const [type, setType] = useState(params.get('entityType') ?? '');
  const [idDraft, setIdDraft] = useState(params.get('entityId') ?? '');
  const [entityId, setEntityId] = useState(idDraft);
  const [open, setOpen] = useState<string | null>(null);
  const q = useAudit(type, entityId);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setEntityId(idDraft.trim());
  };

  return (
    <>
      <PageHead title="Audit log" sub="Newest first. Open a row to see the record before and after." />
      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Record type
          <select className={`${inputClass} w-44`} value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t ? t.replace('_', ' ') : 'Everything'}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
          Record id
          <input
            className={`${inputClass} w-40`}
            value={idDraft}
            onChange={(e) => setIdDraft(e.target.value)}
            placeholder="Any"
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>
      <Table label="Audit log">
        <thead>
          <tr>
            <Th className="w-8" />
            <Th>When</Th>
            <Th>Who</Th>
            <Th>Action</Th>
            <Th>Record</Th>
            <Th>Request</Th>
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={6} />
          ) : q.isError ? (
            <ErrorRow cols={6} error={q.error} retry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyRow cols={6}>Nothing recorded for this filter.</EmptyRow>
          ) : (
            rows.map((a) => {
              const isOpen = open === a.id;
              const href = entityHref(a);
              return (
                <Fragment key={a.id}>
                  <tr className="hover:bg-surface-2" data-testid="audit-row">
                    <Td>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : a.id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Hide the change' : 'Show the change'}
                        className="press grid size-8 place-items-center rounded-[2px] hover:bg-surface-3 pointer-coarse:size-11"
                      >
                        {isOpen ? <CaretDown className="size-4" /> : <CaretRight className="size-4" />}
                      </button>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(a.at)}</Td>
                    <Td className="whitespace-nowrap">
                      {a.actor ? (
                        <>
                          {a.actor.name} <span className="text-ink-3">{ROLE_LABEL[a.actor.role]}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">System</span>
                      )}
                    </Td>
                    <Td className="font-semibold">{a.action}</Td>
                    <Td className="whitespace-nowrap">
                      {href ? (
                        <RowLink href={href}>
                          {a.entityType} #{a.entityId}
                        </RowLink>
                      ) : (
                        <>
                          {a.entityType.replace('_', ' ')} <span className="text-ink-2">{a.entityId}</span>
                        </>
                      )}
                    </Td>
                    <Td className="max-w-40 truncate font-mono text-[12px] text-ink-3">{a.requestId ?? ''}</Td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="border-b border-line bg-surface-2 px-3 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <Json label="Before" value={a.before} />
                          <Json label="After" value={a.after} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </Table>
      <LoadMore hasNext={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
    </>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="grid min-w-0 gap-1">
      <p className="text-[11px] font-bold tracking-[0.08em] text-ink-2 uppercase">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-[2px] border border-line bg-surface p-2 font-mono text-[12px] leading-relaxed">
        {value === null || value === undefined ? 'Nothing' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
