'use client';
// Step 1: where it goes (a saved address or a new one, which is added to the book) and how fast.
import { zodResolver } from '@hookform/resolvers/zod';
import { type Address, AddressInput, type Quote, type ShippingMethod } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { ArrowRight, PencilSimple, Plus } from '@phosphor-icons/react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, get } from '@/lib/api';
import { METHOD_LABEL } from '@/lib/orders';
import { errorMessage } from '../account/forms';
import { Skeleton } from '../ui/bits';
import { Button } from '../ui/button';
import { FormAlert, Input, Select } from '../ui/field';
import type { ShipTo } from './checkout-flow';
import { ChoiceTile, StepHeading, smallLabel } from './choice';

export type NewAddress = Omit<AddressInput, 'label' | 'isDefault'>;
const NewAddressInput = AddressInput.omit({ label: true, isDefault: true });
type Countries = { items: { code: string; name: string }[] };

const FIELDS = ['name', 'line1', 'line2', 'city', 'region', 'postcode', 'countryCode', 'phone'] as const;

export function DeliveryStep({
  addresses,
  shipTo,
  onShipTo,
  method,
  onMethod,
  quote,
  onContinue,
}: {
  addresses: UseQueryResult<{ items: Address[] }>;
  shipTo: ShipTo | null;
  onShipTo: (s: ShipTo) => void;
  method: ShippingMethod;
  onMethod: (m: ShippingMethod) => void;
  quote: UseQueryResult<Quote>;
  onContinue: () => void;
}) {
  const saved = addresses.data?.items ?? [];
  const typed = shipTo && 'address' in shipTo ? shipTo.address : null;
  const [editing, setEditing] = useState(false);
  const formOpen = editing || (addresses.isSuccess && saved.length === 0 && !typed);
  const quoteError = quote.error instanceof ApiError ? quote.error : null;
  const addressErrors = quoteError
    ? Object.fromEntries(
        Object.entries(quoteError.fields)
          .filter(([k]) => k.startsWith('shipTo.address.'))
          .map(([k, v]) => [k.slice('shipTo.address.'.length), v]),
      )
    : {};
  const ready = Boolean(shipTo && quote.data && !quote.isError && !formOpen);

  return (
    <div className="grid gap-10">
      <section className="grid gap-5" aria-label="Deliver to">
        <StepHeading title="Deliver to" />
        {addresses.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 rounded-[2px]" />
            <Skeleton className="h-24 rounded-[2px]" />
          </div>
        ) : addresses.isError ? (
          <FormAlert>
            {errorMessage(addresses.error)}{' '}
            <button type="button" className="link font-semibold" onClick={() => addresses.refetch()}>
              Try again
            </button>
          </FormAlert>
        ) : (
          <div className="grid gap-3" role="radiogroup" aria-label="Saved addresses">
            {saved.map((a) => (
              <ChoiceTile
                key={a.id}
                name="ship-to"
                checked={!formOpen && shipTo !== null && 'addressId' in shipTo && shipTo.addressId === a.id}
                onChange={() => {
                  setEditing(false);
                  onShipTo({ addressId: a.id });
                }}
              >
                <AddressLines address={a} title={a.label ?? a.name} showName={Boolean(a.label)} />
              </ChoiceTile>
            ))}
            {typed && !formOpen && (
              <ChoiceTile name="ship-to" checked onChange={() => {}}>
                <span className="font-semibold">New address</span>
                <AddressLines address={typed} />
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="link mt-1 inline-flex items-center gap-1.5 justify-self-start text-[13px] font-bold tracking-[0.06em] uppercase"
                >
                  <PencilSimple className="size-4" /> Edit
                </button>
              </ChoiceTile>
            )}
            {formOpen ? (
              <NewAddressForm
                initial={typed}
                serverErrors={addressErrors}
                canCancel={saved.length > 0 || typed !== null}
                onCancel={() => setEditing(false)}
                onUse={(address) => {
                  setEditing(false);
                  onShipTo({ address });
                }}
              />
            ) : (
              !typed && (
                <Button
                  variant="outline"
                  className="justify-self-start"
                  onClick={() => setEditing(true)}
                  icon={<Plus weight="bold" className="size-4" />}
                >
                  A new address
                </Button>
              )
            )}
          </div>
        )}
      </section>

      <section className="grid gap-5" aria-label="Delivery speed">
        <h3 className={smallLabel}>Delivery speed</h3>
        {!shipTo || formOpen ? (
          <p className="text-[15px] text-ink-3">Choose an address to see delivery options.</p>
        ) : quote.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-16 rounded-[2px]" />
            <Skeleton className="h-16 rounded-[2px]" />
          </div>
        ) : quoteError && !Object.keys(addressErrors).length ? (
          <FormAlert>{quoteError.message}</FormAlert>
        ) : quote.data ? (
          <div className="grid gap-3" role="radiogroup" aria-label="Delivery speed">
            {quote.data.shippingOptions.map((o) => (
              <ChoiceTile
                key={o.method}
                name="method"
                testId={`method-${o.method}`}
                checked={method === o.method}
                onChange={() => onMethod(o.method)}
                aside={o.free ? 'Free' : formatAmount(o.price)}
              >
                <span className="font-semibold">{METHOD_LABEL[o.method]}</span>
                <span className="text-ink-2">
                  {o.daysMin === o.daysMax ? o.daysMin : `${o.daysMin} to ${o.daysMax}`} working day
                  {o.daysMax === 1 ? '' : 's'} to {quote.data.zone.name}
                </span>
                {!o.free && o.freeFrom && (
                  <span className="text-[13px] text-ink-3">Free on orders from {formatAmount(o.freeFrom)}</span>
                )}
              </ChoiceTile>
            ))}
            {quote.data.toFreeShipping && (
              <p className="text-[14px] text-ink-2">
                Add {formatAmount(quote.data.toFreeShipping)} more for free {METHOD_LABEL[method].toLowerCase()}{' '}
                delivery.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <div className="flex justify-end border-t border-line pt-6">
        <Button
          size="lg"
          onClick={onContinue}
          disabled={!ready || quote.isFetching}
          icon={<ArrowRight weight="bold" className="size-4" />}
          className="w-full sm:w-auto"
        >
          Continue to payment
        </Button>
      </div>
    </div>
  );
}

function AddressLines({
  address: a,
  title,
  showName = true,
}: {
  address: Pick<Address, 'name' | 'line1' | 'line2' | 'city' | 'region' | 'postcode'> & { countryName?: string };
  title?: string;
  showName?: boolean;
}) {
  return (
    <>
      {title && <span className="font-semibold">{title}</span>}
      {showName && <span>{a.name}</span>}
      <span className="text-ink-2">
        {a.line1}
        {a.line2 && <>, {a.line2}</>}, {a.postcode} {a.city}
        {a.region && <>, {a.region}</>}
        {a.countryName && <>, {a.countryName}</>}
      </span>
    </>
  );
}

function NewAddressForm(props: {
  initial: NewAddress | null;
  serverErrors: Record<string, string>;
  canCancel: boolean;
  onCancel: () => void;
  onUse: (a: NewAddress) => void;
}) {
  const countries = useQuery({
    queryKey: ['countries'],
    queryFn: () => get<Countries>('/countries'),
    staleTime: Infinity,
  });
  if (countries.isError) {
    return (
      <FormAlert>
        {errorMessage(countries.error)}{' '}
        <button type="button" className="link font-semibold" onClick={() => countries.refetch()}>
          Try again
        </button>
      </FormAlert>
    );
  }
  if (!countries.data) {
    return (
      <div className="grid gap-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  return <AddressFields {...props} countries={countries.data.items} />;
}

function AddressFields({
  initial,
  serverErrors,
  canCancel,
  onCancel,
  onUse,
  countries,
}: Parameters<typeof NewAddressForm>[0] & { countries: Countries['items'] }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(NewAddressInput),
    defaultValues: {
      name: initial?.name ?? '',
      line1: initial?.line1 ?? '',
      line2: initial?.line2 ?? '',
      city: initial?.city ?? '',
      region: initial?.region ?? '',
      postcode: initial?.postcode ?? '',
      countryCode: initial?.countryCode ?? '',
      phone: initial?.phone ?? '',
    },
  });
  // Errors the API found in the quote (a postcode the zone does not accept, for example) show on the field.
  const serverKey = JSON.stringify(serverErrors);
  useEffect(() => {
    for (const [k, message] of Object.entries(JSON.parse(serverKey) as Record<string, string>)) {
      if ((FIELDS as readonly string[]).includes(k)) setError(k as (typeof FIELDS)[number], { message });
    }
  }, [serverKey, setError]);

  return (
    <form
      onSubmit={handleSubmit((v) => onUse(v as NewAddress))}
      noValidate
      aria-label="New address"
      className="grid gap-4 rounded-[2px] border border-ink bg-surface p-4 sm:p-5"
    >
      <p className={smallLabel}>New address</p>
      <Input label="Full name" autoComplete="name" error={errors.name?.message} {...register('name')} />
      <Input label="Address" autoComplete="address-line1" error={errors.line1?.message} {...register('line1')} />
      <Input
        label="Apartment, suite"
        optional
        autoComplete="address-line2"
        error={errors.line2?.message}
        {...register('line2')}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
        <Input label="Postcode" autoComplete="postal-code" error={errors.postcode?.message} {...register('postcode')} />
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
      <p className="text-[13px] text-ink-3">We save it to your address book when you place the order.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline">
          Use this address
        </Button>
        {canCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
