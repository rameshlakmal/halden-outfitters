'use client';
// Step 3: everything once more, then Place order.
import type { Address, Cart, Quote, ShippingMethod } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { ArrowLeft, Lock } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { METHOD_LABEL } from '@/lib/orders';
import { TotalsTable } from '../orders/totals';
import { Button } from '../ui/button';
import { FormAlert } from '../ui/field';
import { type CardValues, brandOf, digits } from './card';
import type { ShipTo } from './checkout-flow';
import { StepHeading, smallLabel } from './choice';

export function ReviewStep({
  cart,
  quote,
  shipTo,
  addresses,
  method,
  card,
  placing,
  error,
  onBack,
  onPlace,
  onEdit,
}: {
  cart: Cart;
  quote: Quote;
  shipTo: ShipTo;
  addresses: Address[];
  method: ShippingMethod;
  card: CardValues | null;
  placing: boolean;
  error: { message: string; toCart?: boolean } | null;
  onBack: () => void;
  onPlace: () => void;
  onEdit: (step: 1 | 2) => void;
}) {
  const savedAddress = 'addressId' in shipTo ? addresses.find((x) => x.id === shipTo.addressId) : undefined;
  const a = 'addressId' in shipTo ? savedAddress : shipTo.address;
  const country = savedAddress?.countryName;
  const option = quote.shippingOptions.find((o) => o.method === method);

  return (
    <div className="grid gap-10">
      <StepHeading title="Review" />

      {error && (
        <div data-testid="place-error">
          <FormAlert>
            {error.message}
            {error.toCart && (
              <>
                {' '}
                <Link href="/cart" className="link font-semibold">
                  Go to your cart
                </Link>
              </>
            )}
          </FormAlert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Deliver to" onEdit={() => onEdit(1)}>
          {a ? (
            <>
              <span className="font-semibold">{a.name}</span>
              <span className="text-ink-2">
                {a.line1}
                {a.line2 && <>, {a.line2}</>}
              </span>
              <span className="text-ink-2">
                {a.postcode} {a.city}
                {a.region && <>, {a.region}</>}
              </span>
              {country && <span className="text-ink-2">{country}</span>}
            </>
          ) : (
            <span className="text-ink-3">Address not found. Choose it again.</span>
          )}
          {option && (
            <span className="mt-2">
              {METHOD_LABEL[method]}, {option.daysMin} to {option.daysMax} working days
            </span>
          )}
        </Block>
        <Block title="Payment" onEdit={() => onEdit(2)}>
          {card ? (
            <span>
              {brandOf(card.number)} ending {digits(card.number).slice(-4)}
            </span>
          ) : (
            <span>No card needed</span>
          )}
          {quote.points.redeemed > 0 && (
            <span className="text-ink-2">{quote.points.redeemed.toLocaleString('en-GB')} Halden Points</span>
          )}
          {quote.storeCredit.applied !== '0.00' && (
            <span className="text-ink-2">{formatAmount(quote.storeCredit.applied)} store credit</span>
          )}
        </Block>
      </div>

      <section aria-label="Items" className="grid gap-3">
        <h3 className={smallLabel}>
          {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}
        </h3>
        <ul className="grid divide-y divide-line border-y border-line">
          {cart.lines.map((l) => (
            <li key={l.productId} className="flex items-center gap-4 py-3">
              <Image
                src={l.image.url}
                alt=""
                width={64}
                height={64}
                sizes="64px"
                className="size-16 shrink-0 rounded-[2px] bg-surface-2 object-cover"
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate font-medium">{l.name}</span>
                <span className="text-[14px] text-ink-3 tabular-nums">
                  {l.qty} x {formatAmount(l.unitPrice)}
                </span>
              </span>
              <span className="tabular-nums">{formatAmount(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-6 md:hidden">
        <TotalsTable totals={quote.totals} coupon={cart.coupon?.applied ? cart.coupon.code : null} />
      </div>

      <div className="grid gap-4 border-t border-line pt-6">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={onBack} icon={<ArrowLeft weight="bold" className="size-4" />}>
            Payment
          </Button>
          <Button
            size="lg"
            onClick={onPlace}
            busy={placing}
            icon={<Lock weight="bold" className="size-4" />}
            className="w-full sm:w-auto"
          >
            Place order, {formatAmount(quote.totals.amountDue)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Block({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1 rounded-[2px] border border-line-strong bg-surface p-4 text-[15px] leading-relaxed">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className={smallLabel}>{title}</span>
        <button
          type="button"
          onClick={onEdit}
          className="link min-h-9 text-[12px] font-bold tracking-[0.06em] uppercase pointer-coarse:min-h-11"
          aria-label={`Change ${title.toLowerCase()}`}
        >
          Change
        </button>
      </div>
      {children}
    </div>
  );
}
