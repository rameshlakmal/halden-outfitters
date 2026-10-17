'use client';
// Customers and staff accounts. Support finds people; an admin can change an account's role, which signs that
// account out everywhere so the new permissions apply at once.
import type { Role } from '@halden/contracts';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { formatDate } from '@/lib/orders';
import { useSession } from '@/lib/queries';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { useToast } from '../ui/toast';
import { type Customer, ROLE_LABEL, sendEmpty, useStaffCustomers } from './api';
import { Dialog, EmptyRow, ErrorRow, inputClass, LoadMore, PageHead, SkeletonRows, Table, Td, Th } from './ui';

const ROLES: Role[] = ['customer', 'support', 'warehouse', 'admin'];

export function CustomerList() {
  const { data: me } = useSession();
  const [search, setSearch] = useState('');
  const q = useStaffCustomers(useDeferredValue(search.trim()));
  const [change, setChange] = useState<{ customer: Customer; role: Role } | null>(null);
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const admin = me?.role === 'admin';
  return (
    <>
      <PageHead
        title="Customers"
        sub={admin ? 'Change a role from the list; it signs that account out.' : 'Find an account by name or email.'}
      />
      <label className="relative w-full max-w-sm">
        <span className="sr-only">Search by name or email</span>
        <MagnifyingGlass className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
        <input
          className={`${inputClass} pl-8`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or email"
          type="search"
        />
      </label>
      <Table label="Customers">
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Role</Th>
            <Th>Verified</Th>
            <Th className="text-right">Orders</Th>
            <Th>Joined</Th>
            <Th>Sign-in</Th>
          </tr>
        </thead>
        <tbody>
          {q.isPending ? (
            <SkeletonRows cols={7} />
          ) : q.isError ? (
            <ErrorRow cols={7} error={q.error} retry={() => void q.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyRow cols={7}>Nobody matches that search.</EmptyRow>
          ) : (
            rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2">
                <Td className="font-semibold">{c.name}</Td>
                <Td className="max-w-60 truncate">{c.email}</Td>
                <Td>
                  {admin && c.id !== me?.id ? (
                    <select
                      className={`${inputClass} w-36`}
                      value={c.role}
                      aria-label={`Role for ${c.name}`}
                      onChange={(e) => setChange({ customer: c, role: e.target.value as Role })}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABEL[c.role]
                  )}
                </Td>
                <Td>{c.emailVerified ? 'Yes' : <span className="text-ink-3">No</span>}</Td>
                <Td className="text-right tabular-nums">{c.orderCount}</Td>
                <Td className="whitespace-nowrap text-ink-2">{formatDate(c.createdAt)}</Td>
                <Td>
                  {c.lockedUntil && new Date(c.lockedUntil) > new Date() ? (
                    <span className="font-semibold text-danger">Locked</span>
                  ) : (
                    'OK'
                  )}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
      <LoadMore hasNext={!!q.hasNextPage} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} />
      {change && <RoleDialog change={change} onClose={() => setChange(null)} />}
    </>
  );
}

function RoleDialog({ change, onClose }: { change: { customer: Customer; role: Role }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { customer: c, role } = change;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendEmpty('PUT', `/staff/customers/${c.id}/role`, { role });
      toast.show(`${c.name} is now ${ROLE_LABEL[role].toLowerCase()}`);
      void qc.invalidateQueries({ queryKey: ['staff', 'customers'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title="Change role">
      <p className="text-[14px] leading-relaxed text-ink-2">
        Make <span className="font-semibold text-ink">{c.name}</span> ({c.email}) {ROLE_LABEL[role].toLowerCase()}{' '}
        instead of {ROLE_LABEL[c.role].toLowerCase()}? They are signed out on every device and sign in again with the
        new permissions.
      </p>
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Keep {ROLE_LABEL[c.role].toLowerCase()}
        </Button>
        <Button size="sm" busy={busy} onClick={() => void confirm()}>
          Change role
        </Button>
      </div>
    </Dialog>
  );
}
