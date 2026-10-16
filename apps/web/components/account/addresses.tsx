'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { type Address, AddressInput, MAX_ADDRESSES } from '@halden/contracts';
import { MapPin, PencilSimple, Plus, Star, Trash, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, del, get, post, put } from '@/lib/api';
import { withViewTransition } from '@/lib/motion';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert, Input, Select } from '../ui/field';
import { useToast } from '../ui/toast';
import { applyApiError, errorMessage } from './forms';
import { useAccount } from './use-account';

type List = { items: Address[] };
const KEY = ['addresses'] as const;

export function AddressBook() {
  const { me } = useAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: KEY, queryFn: () => get<List>('/account/addresses'), enabled: Boolean(me) });
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const items = list.data?.items ?? [];
  const full = items.length >= MAX_ADDRESSES;

  const onSaved = (data: List, message: string) => {
    qc.setQueryData(KEY, data);
    setEditing(null);
    toast.show(message);
  };
  const makeDefault = useMutation({
    mutationFn: (id: string) => post<List>(`/account/addresses/${id}/default`),
    // The new default moves to the front; the tiles glide to their new places in a view transition.
    onSuccess: (data) => withViewTransition(() => onSaved(data, 'Default address changed')),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del<List>(`/account/addresses/${id}`),
    onSuccess: (data) => withViewTransition(() => onSaved(data, 'Address removed')),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  return (
    <div className="grid gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Addresses</h1>
          <p className="text-ink-2">Up to {MAX_ADDRESSES} addresses. Your default is filled in at checkout.</p>
        </div>
        <Button
          onClick={() => setEditing('new')}
          disabled={full || list.isPending}
          icon={<Plus weight="bold" className="size-4" />}
        >
          Add address
        </Button>
      </header>
      {full && <FormAlert tone="info">Your address book is full. Remove an address to add a new one.</FormAlert>}

      {list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-44 rounded-[2px]" />
          ))}
        </div>
      ) : list.isError ? (
        <FormAlert>
          {errorMessage(list.error)}{' '}
          <button type="button" className="link font-semibold" onClick={() => list.refetch()}>
            Try again
          </button>
        </FormAlert>
      ) : items.length === 0 ? (
        <div className="grid justify-items-start gap-3 rounded-[2px] border border-dashed border-line-strong px-6 py-10">
          <MapPin className="size-8 text-ink-3" weight="thin" />
          <p className="font-medium">No addresses yet</p>
          <p className="max-w-[44ch] text-sm text-ink-2">
            Add one now and checkout will be quicker. The first address becomes your default.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((a) => (
            <li key={a.id} className="enter vt-line" style={{ viewTransitionName: `address-${a.id}` }}>
              <AddressTile
                address={a}
                busy={makeDefault.isPending || remove.isPending}
                onEdit={() => setEditing(a)}
                onDefault={() => makeDefault.mutate(a.id)}
                onRemove={() => remove.mutate(a.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <AddressDialog
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={(data) => onSaved(data, editing === 'new' ? 'Address added' : 'Address saved')}
      />
    </div>
  );
}

function AddressTile({
  address: a,
  busy,
  onEdit,
  onDefault,
  onRemove,
}: {
  address: Address;
  busy: boolean;
  onEdit: () => void;
  onDefault: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      className={`grid h-full content-between gap-5 rounded-[2px] border p-5 ${a.isDefault ? 'border-brand/40 bg-brand-soft/40' : 'border-line bg-surface'}`}
    >
      <div className="grid gap-1 text-[15px] leading-relaxed">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold">{a.label ?? a.name}</span>
          {a.isDefault && (
            <span className="rounded-[2px] bg-brand px-2 py-0.5 text-xs font-medium text-brand-ink">Default</span>
          )}
        </div>
        {a.label && <span>{a.name}</span>}
        <span className="text-ink-2">
          {a.line1}
          {a.line2 && <>, {a.line2}</>}
        </span>
        <span className="text-ink-2">
          {a.postcode} {a.city}
          {a.region && <>, {a.region}</>}
        </span>
        <span className="text-ink-2">{a.countryName}</span>
        {a.phone && <span className="text-ink-3">{a.phone}</span>}
      </div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm removal">
          <span className="text-sm text-ink-2">Remove this address?</span>
          <Button size="sm" variant="danger" onClick={onRemove} busy={busy}>
            Remove
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} icon={<PencilSimple className="size-4" />}>
            Edit
          </Button>
          {!a.isDefault && (
            <Button size="sm" variant="ghost" onClick={onDefault} disabled={busy} icon={<Star className="size-4" />}>
              Make default
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(true)}
            disabled={busy}
            icon={<Trash className="size-4" />}
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}

const FIELDS = [
  'label',
  'name',
  'line1',
  'line2',
  'city',
  'region',
  'postcode',
  'countryCode',
  'phone',
  'isDefault',
] as const;

function toForm(a: Address | null) {
  return {
    label: a?.label ?? '',
    name: a?.name ?? '',
    line1: a?.line1 ?? '',
    line2: a?.line2 ?? '',
    city: a?.city ?? '',
    region: a?.region ?? '',
    postcode: a?.postcode ?? '',
    countryCode: a?.countryCode ?? '',
    phone: a?.phone ?? '',
    isDefault: a?.isDefault ?? false,
  };
}

function AddressDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: Address | 'new' | null;
  onClose: () => void;
  onSaved: (data: List) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (editing && !d.open) d.showModal();
    if (!editing && d.open) d.close();
  }, [editing]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-label={editing === 'new' ? 'Add an address' : 'Edit address'}
      className="pop mx-auto mt-[6vh] max-h-[88dvh] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-[2px] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)]"
    >
      {editing && (
        <AddressFormLoader
          key={editing === 'new' ? 'new' : editing.id}
          address={editing === 'new' ? null : editing}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </dialog>
  );
}

type Countries = { items: { code: string; name: string }[] };
type FormProps = { address: Address | null; onClose: () => void; onSaved: (data: List) => void };

/** The country list must be in the select before the form sets its value, so the form waits for it. */
function AddressFormLoader(props: FormProps) {
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: () => get<Countries>('/countries'),
    staleTime: Infinity,
  });
  if (countries.isError) {
    return (
      <div className="grid gap-4 p-5">
        <FormAlert>{errorMessage(countries.error)}</FormAlert>
        <Button variant="outline" onClick={() => countries.refetch()} className="justify-self-start">
          Try again
        </Button>
      </div>
    );
  }
  if (!countries.data) {
    return (
      <div className="grid gap-4 p-5" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  return <AddressForm {...props} countries={countries.data.items} />;
}

function AddressForm({ address, onClose, onSaved, countries }: FormProps & { countries: Countries['items'] }) {
  const [alert, setAlert] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(AddressInput), defaultValues: toForm(address) });

  const onSubmit = handleSubmit(async (values) => {
    setAlert(null);
    try {
      const data = address
        ? await put<List>(`/account/addresses/${address.id}`, values)
        : await post<List>('/account/addresses', values);
      onSaved(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'address_limit_reached') return setAlert(err.message);
      const message = applyApiError(err, setError, FIELDS);
      if (message) setAlert(message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid">
      <header className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{address ? 'Edit address' : 'Add an address'}</h2>
        <button
          type="button"
          onClick={onClose}
          className="press grid size-9 place-items-center rounded-[2px] text-ink-2 hover:bg-surface-2"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </header>
      <div className="grid gap-4 px-5 py-5">
        {alert && <FormAlert>{alert}</FormAlert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name" autoComplete="name" error={errors.name?.message} {...register('name')} />
          <Input
            label="Label"
            optional
            placeholder="Home, Cabin"
            error={errors.label?.message}
            {...register('label')}
          />
        </div>
        <Input label="Address" autoComplete="address-line1" error={errors.line1?.message} {...register('line1')} />
        <Input
          label="Apartment, suite"
          optional
          autoComplete="address-line2"
          error={errors.line2?.message}
          {...register('line2')}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
          <Input
            label="Postcode"
            autoComplete="postal-code"
            error={errors.postcode?.message}
            {...register('postcode')}
          />
          <Input label="City" autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="State or region"
            optional
            autoComplete="address-level1"
            error={errors.region?.message}
            {...register('region')}
          />
          <Select
            label="Country"
            autoComplete="country"
            placeholder="Choose a country"
            options={countries.map((c) => ({ value: c.code, label: c.name }))}
            error={errors.countryCode?.message}
            {...register('countryCode')}
          />
        </div>
        <Input
          label="Phone"
          optional
          type="tel"
          autoComplete="tel"
          hint="Only used by the courier."
          error={errors.phone?.message}
          {...register('phone')}
        />
        {!address?.isDefault && (
          <label className="flex items-center gap-3 text-[15px]">
            <input type="checkbox" className="size-5 rounded accent-[var(--brand)]" {...register('isDefault')} />
            Make this my default address
          </label>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" busy={isSubmitting}>
          {address ? 'Save address' : 'Add address'}
        </Button>
      </footer>
    </form>
  );
}
