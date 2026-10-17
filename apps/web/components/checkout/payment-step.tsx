'use client';
// Step 2: Halden Points and store credit first, then the card for whatever is left (no card when nothing is).
import type { Quote } from '@halden/contracts';
import { formatAmount } from '@halden/money';
import { ArrowLeft, ArrowRight, CreditCard, Minus, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '../ui/button';
import { FormAlert, Input } from '../ui/field';
import { type CardErrors, type CardValues, TEST_CARDS, checkCard, formatExpiry, formatNumber } from './card';
import { StepHeading, smallLabel } from './choice';

const POINT_BLOCK = 100;

export function PaymentStep({
  quote,
  needCard,
  card,
  onCard,
  serverErrors,
  onClearServerErrors,
  paymentError,
  points,
  onPoints,
  useCredit,
  onUseCredit,
  onBack,
  onContinue,
}: {
  quote: Quote | undefined;
  needCard: boolean;
  card: CardValues;
  onCard: (v: CardValues) => void;
  serverErrors: CardErrors;
  onClearServerErrors: () => void;
  paymentError: string | null;
  points: number;
  onPoints: (n: number) => void;
  useCredit: boolean;
  onUseCredit: (on: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [tried, setTried] = useState(false);
  const local = tried ? checkCard(card) : {};
  const errors: CardErrors = { ...local, ...serverErrors };
  const set = (patch: Partial<CardValues>) => {
    onClearServerErrors();
    onCard({ ...card, ...patch });
  };

  const next = () => {
    if (needCard) {
      setTried(true);
      if (Object.keys(checkCard(card)).length) return;
    }
    onContinue();
  };

  const nextYear = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');

  return (
    <div className="grid gap-10">
      <StepHeading title="Payment">Nothing is taken until we ship. Your bank holds the amount until then.</StepHeading>

      {paymentError && (
        <div data-testid="payment-error">
          <FormAlert>{paymentError}</FormAlert>
        </div>
      )}

      {quote && (quote.points.available > 0 || quote.storeCredit.balance !== '0.00') && (
        <section className="grid gap-4" aria-label="Points and store credit">
          <h3 className={smallLabel}>Points and credit</h3>
          {quote.points.available > 0 && (
            <PointsControl
              available={quote.points.available}
              max={quote.points.maxRedeemable}
              value={points}
              onChange={onPoints}
              off={quote.totals.pointsDiscount}
            />
          )}
          {quote.storeCredit.balance !== '0.00' && (
            <label className="flex min-h-14 cursor-pointer items-center gap-4 rounded-[2px] border border-line-strong bg-surface px-4 py-3 has-[:focus-visible]:outline-2">
              <input
                type="checkbox"
                role="switch"
                checked={useCredit}
                onChange={(e) => onUseCredit(e.target.checked)}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-11 shrink-0 rounded-[2px] border border-ink bg-surface-2 transition-colors duration-150 peer-checked:bg-ink after:absolute after:top-[3px] after:left-[3px] after:size-4 after:rounded-[1px] after:bg-ink after:transition-transform after:duration-200 peer-checked:after:translate-x-5 peer-checked:after:bg-bg motion-reduce:after:transition-none"
              />
              <span className="grid gap-0.5 text-[15px]">
                <span className="font-semibold">
                  Use store credit (balance {formatAmount(quote.storeCredit.balance)})
                </span>
                {useCredit && quote.storeCredit.applied !== '0.00' && (
                  <span className="text-ink-2">
                    {formatAmount(quote.storeCredit.applied)} of it goes to this order.
                  </span>
                )}
              </span>
            </label>
          )}
        </section>
      )}

      {needCard ? (
        <section className="grid gap-5" aria-label="Card">
          <div className="flex items-end justify-between gap-3">
            <h3 className={smallLabel}>Card</h3>
            {quote && quote.totals.amountDue !== quote.totals.total && (
              <span className="text-[14px] text-ink-2">
                Charged to card{' '}
                <strong className="text-ink tabular-nums">{formatAmount(quote.totals.amountDue)}</strong>
              </span>
            )}
          </div>
          <div className="grid gap-4 rounded-[2px] border border-line-strong bg-surface p-4 sm:p-5">
            <Input
              label="Card number"
              inputMode="numeric"
              autoComplete="cc-number"
              placeholder="1234 1234 1234 1234"
              value={card.number}
              onChange={(e) => set({ number: formatNumber(e.target.value) })}
              error={errors.number}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Expiry"
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM / YY"
                value={card.expiry}
                onChange={(e) => set({ expiry: formatExpiry(e.target.value) })}
                error={errors.expiry}
              />
              <Input
                label="Security code"
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="123"
                maxLength={4}
                value={card.cvc}
                onChange={(e) => set({ cvc: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                error={errors.cvc}
              />
            </div>
            <Input
              label="Name on card"
              autoComplete="cc-name"
              value={card.name}
              onChange={(e) => set({ name: e.target.value })}
              error={errors.name}
            />
          </div>

          <details className="group rounded-[2px] border border-dashed border-line-strong" open>
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
              <CreditCard className="size-4 text-accent" weight="bold" />
              <span className={smallLabel}>Test cards</span>
              <span className="text-[13px] text-ink-3">This shop takes no real money.</span>
            </summary>
            <ul className="grid gap-1 border-t border-line px-4 py-3">
              {TEST_CARDS.map((t) => (
                <li key={t.number} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <span className="text-[14px]">
                    <span className="font-mono tabular-nums">{t.number}</span>
                    <span className="ml-2 text-ink-3">{t.label}</span>
                  </span>
                  <button
                    type="button"
                    className="link min-h-9 text-[12px] font-bold tracking-[0.06em] uppercase pointer-coarse:min-h-11"
                    aria-label={`Use test card ending ${t.number.slice(-4)}`}
                    onClick={() =>
                      set({
                        number: t.number,
                        expiry: card.expiry || `12 / ${nextYear}`,
                        cvc: card.cvc || '123',
                      })
                    }
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </section>
      ) : (
        <FormAlert tone="success">Your points and store credit cover the whole order. No card needed.</FormAlert>
      )}

      <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onBack} icon={<ArrowLeft weight="bold" className="size-4" />}>
          Delivery
        </Button>
        <Button
          size="lg"
          onClick={next}
          disabled={!quote}
          icon={<ArrowRight weight="bold" className="size-4" />}
          className="w-full sm:w-auto"
        >
          Review order
        </Button>
      </div>
    </div>
  );
}

function PointsControl({
  available,
  max,
  value,
  onChange,
  off,
}: {
  available: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
  off: string;
}) {
  const top = Math.floor(max / POINT_BLOCK) * POINT_BLOCK;
  const btn =
    'press grid size-11 place-items-center rounded-[2px] border border-ink bg-surface text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-3';
  return (
    <div className="grid gap-3 rounded-[2px] border border-line-strong bg-surface px-4 py-4">
      <div className="grid gap-0.5 text-[15px]">
        <span className="font-semibold">Halden Points</span>
        <span className="text-ink-2">
          You have {available.toLocaleString('en-GB')} points.{' '}
          {top > 0
            ? `Use up to ${top.toLocaleString('en-GB')} on this order, in blocks of ${POINT_BLOCK}.`
            : `You need ${POINT_BLOCK} to use them on an order.`}
        </span>
      </div>
      {top > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2" role="group" aria-label="Points to use">
            <button
              type="button"
              className={btn}
              onClick={() => onChange(Math.max(0, value - POINT_BLOCK))}
              disabled={value <= 0}
              aria-label={`${POINT_BLOCK} fewer points`}
            >
              <Minus weight="bold" className="size-4" />
            </button>
            <output
              aria-live="polite"
              data-testid="points-value"
              className="min-w-24 text-center text-lg font-bold tabular-nums"
            >
              {value.toLocaleString('en-GB')}
            </output>
            <button
              type="button"
              className={btn}
              onClick={() => onChange(Math.min(top, value + POINT_BLOCK))}
              disabled={value >= top}
              aria-label={`${POINT_BLOCK} more points`}
            >
              <Plus weight="bold" className="size-4" />
            </button>
          </div>
          <span className="text-[14px] text-ink-2">
            {value > 0 && off !== '0.00' ? <span className="text-accent">{formatAmount(off)} off</span> : 'None used'}
          </span>
          {value < top && (
            <button
              type="button"
              className="link min-h-9 text-[12px] font-bold tracking-[0.06em] uppercase pointer-coarse:min-h-11"
              onClick={() => onChange(top)}
            >
              Use the most
            </button>
          )}
        </div>
      )}
    </div>
  );
}
