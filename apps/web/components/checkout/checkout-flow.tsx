'use client';
// Checkout in three steps: Delivery, Payment, Review. The quote (shipping, tax, points, store credit, total)
// comes from the API every time an input changes, so what's shown is what the order will be.
// Placing the order sends an Idempotency-Key: a retry of the same submission reuses it (one order, however many
// clicks), and any change to what's being bought makes a new one.
import type { Address, Cart, CheckoutResult, Quote, ShippingMethod } from '@halden/contracts';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, get, post } from '@/lib/api';
import { animate } from '@/lib/motion';
import { orderKeys } from '@/lib/orders';
import { keys } from '@/lib/queries';
import { type CardValues, digits, parseExpiry } from './card';
import { DeliveryStep, type NewAddress } from './delivery-step';
import { MobileSummary, OrderSummary } from './order-summary';
import { PaymentStep } from './payment-step';
import { ReviewStep } from './review-step';

export type ShipTo = { addressId: string } | { address: NewAddress };
type Step = 1 | 2 | 3;
const STEP_NAMES = ['Delivery', 'Payment', 'Review'] as const;

export function CheckoutFlow({ cart }: { cart: Cart }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const dir = useRef(1);
  const [shipTo, setShipTo] = useState<ShipTo | null>(null);
  const [method, setMethod] = useState<ShippingMethod>('standard');
  const [points, setPoints] = useState(0);
  const [useCredit, setUseCredit] = useState(false);
  const [card, setCard] = useState<CardValues>({ number: '', expiry: '', cvc: '', name: '' });
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [cardFieldErrors, setCardFieldErrors] = useState<Partial<Record<keyof CardValues, string>>>({});
  const [placeError, setPlaceError] = useState<{ message: string; toCart?: boolean } | null>(null);
  const [placing, setPlacing] = useState(false);
  const attempt = useRef<{ hash: string; key: string } | null>(null);

  const addresses = useQuery({
    queryKey: ['addresses'],
    queryFn: () => get<{ items: Address[] }>('/account/addresses'),
  });

  // Start with the default address, or the new-address form when the book is empty.
  useEffect(() => {
    if (shipTo || !addresses.data) return;
    const def = addresses.data.items.find((a) => a.isDefault) ?? addresses.data.items[0];
    if (def) setShipTo({ addressId: def.id });
  }, [addresses.data, shipTo]);

  const cartKey = `${cart.subtotal}|${cart.itemCount}|${cart.coupon?.code ?? ''}|${cart.coupon?.applied ?? ''}`;
  const quote = useQuery({
    queryKey: ['quote', JSON.stringify(shipTo), method, points, useCredit, cartKey],
    queryFn: () =>
      post<Quote>('/checkout/quote', {
        shipTo,
        shippingMethod: method,
        pointsToRedeem: points,
        useStoreCredit: useCredit,
      }),
    enabled: shipTo !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Keep choices valid for the new address: express may not exist there, and fewer points may be usable.
  useEffect(() => {
    const q = quote.data;
    if (!q) return;
    if (!q.shippingOptions.some((o) => o.method === method)) setMethod('standard');
    if (points > q.points.maxRedeemable) setPoints(Math.floor(q.points.maxRedeemable / 100) * 100);
  }, [quote.data, method, points]);
  useEffect(() => {
    if (quote.error instanceof ApiError && quote.error.fields.shippingMethod) setMethod('standard');
  }, [quote.error]);

  const needCard = !quote.data || quote.data.totals.amountDue !== '0.00';

  const go = (next: Step) => {
    dir.current = next > step ? 1 : -1;
    setStep(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Each step slides in from the side it comes from (transform and opacity only).
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    void animate(
      panel.current,
      [
        { opacity: 0, transform: `translateX(${dir.current * 28}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 380 },
    );
  }, [step]);

  const place = async () => {
    if (!shipTo || !quote.data) return;
    setPlaceError(null);
    setPlacing(true);
    const exp = parseExpiry(card.expiry);
    const body = {
      shipTo,
      shippingMethod: method,
      pointsToRedeem: points,
      useStoreCredit: useCredit,
      card: needCard
        ? {
            number: digits(card.number),
            expMonth: exp?.month ?? 0,
            expYear: exp?.year ?? 0,
            cvc: card.cvc,
            name: card.name.trim(),
          }
        : undefined,
    };
    const hash = JSON.stringify([body, cartKey]);
    if (!attempt.current || attempt.current.hash !== hash) attempt.current = { hash, key: crypto.randomUUID() };
    try {
      const result = await post<CheckoutResult>('/checkout', body, { 'Idempotency-Key': attempt.current.key });
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.cart }),
        qc.invalidateQueries({ queryKey: orderKeys.all }),
      ]);
      if (result.nextAction) {
        const url = new URL(result.nextAction.url, window.location.origin);
        if (url.origin === window.location.origin) router.push(`${url.pathname}${url.search}`);
        else window.location.assign(url.toString());
      } else {
        router.push(`/checkout/confirmation/${result.orderId}`);
      }
    } catch (err) {
      setPlacing(false);
      if (!(err instanceof ApiError)) return setPlaceError({ message: 'Something went wrong. Please try again.' });
      if (err.code === 'payment_declined' || err.code === 'payment_failed') {
        setPaymentError(err.message);
        return go(2);
      }
      const cardErrors = Object.fromEntries(
        Object.entries(err.fields)
          .filter(([k]) => k.startsWith('card.'))
          .map(([k, v]) => [k === 'card.expMonth' || k === 'card.expYear' ? 'expiry' : k.slice(5), v]),
      );
      if (Object.keys(cardErrors).length) {
        setCardFieldErrors(cardErrors);
        return go(2);
      }
      if (err.code === 'cart_has_problems' || err.code === 'cart_empty') {
        await qc.invalidateQueries({ queryKey: keys.cart });
        return setPlaceError({ message: err.message, toCart: true });
      }
      if (err.code === 'coupon_invalid') await qc.invalidateQueries({ queryKey: keys.cart });
      setPlaceError({ message: err.message });
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] md:gap-12">
      <div className="grid min-w-0 content-start gap-8">
        <header className="grid gap-5">
          <h1 className="text-5xl sm:text-6xl">Checkout</h1>
          <ol className="grid grid-cols-3 gap-2" aria-label="Checkout steps">
            {STEP_NAMES.map((name, i) => {
              const n = (i + 1) as Step;
              const done = n < step;
              const current = n === step;
              return (
                <li key={name}>
                  <button
                    type="button"
                    disabled={!done}
                    onClick={() => go(n)}
                    aria-current={current ? 'step' : undefined}
                    className={`grid w-full gap-1.5 border-t-[3px] pt-2 text-left disabled:cursor-default ${
                      current ? 'border-accent' : done ? 'border-ink' : 'border-line'
                    }`}
                  >
                    <span
                      className={`text-[12px] font-bold tracking-[0.08em] uppercase ${current ? 'text-accent' : done ? 'text-ink' : 'text-ink-3'}`}
                    >
                      {name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </header>

        <MobileSummary cart={cart} quote={quote.data} />

        <div ref={panel} key={step}>
          {step === 1 && (
            <DeliveryStep
              addresses={addresses}
              shipTo={shipTo}
              onShipTo={setShipTo}
              method={method}
              onMethod={setMethod}
              quote={quote}
              onContinue={() => go(2)}
            />
          )}
          {step === 2 && (
            <PaymentStep
              quote={quote.data}
              needCard={needCard}
              card={card}
              onCard={(v) => {
                setCard(v);
                setPaymentError(null);
              }}
              serverErrors={cardFieldErrors}
              onClearServerErrors={() => setCardFieldErrors({})}
              paymentError={paymentError}
              points={points}
              onPoints={setPoints}
              useCredit={useCredit}
              onUseCredit={setUseCredit}
              onBack={() => go(1)}
              onContinue={() => go(3)}
            />
          )}
          {step === 3 && quote.data && shipTo && (
            <ReviewStep
              cart={cart}
              quote={quote.data}
              shipTo={shipTo}
              addresses={addresses.data?.items ?? []}
              method={method}
              card={needCard ? card : null}
              placing={placing}
              error={placeError}
              onBack={() => go(2)}
              onPlace={place}
              onEdit={(n) => go(n)}
            />
          )}
        </div>
      </div>
      <aside className="hidden md:block">
        <div className="sticky top-24">
          <OrderSummary cart={cart} quote={quote.data} />
        </div>
      </aside>
    </div>
  );
}
