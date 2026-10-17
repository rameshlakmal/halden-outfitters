// Money rows for an order or a quote: subtotal, coupon, points, shipping, tax, total, store credit and what the
// card is charged.
import type { Totals } from '@halden/contracts';
import { formatAmount } from '@halden/money';

const nonZero = (a: string | undefined): a is string => a !== undefined && a !== '0.00';

export function TotalsTable({
  totals,
  coupon,
  totalTestId,
}: {
  totals: Totals;
  coupon?: string | null;
  totalTestId?: string;
}) {
  const credit = nonZero(totals.storeCredit);
  return (
    <dl className="grid gap-2 text-[15px]">
      <Row label="Subtotal" value={formatAmount(totals.subtotal)} />
      {nonZero(totals.discount) && (
        <Row label={coupon ? `Discount (${coupon})` : 'Discount'} value={`-${formatAmount(totals.discount)}`} accent />
      )}
      {nonZero(totals.pointsDiscount) && (
        <Row label="Paid with Halden Points" value={`-${formatAmount(totals.pointsDiscount)}`} accent />
      )}
      <Row label="Shipping" value={totals.shipping === '0.00' ? 'Free' : formatAmount(totals.shipping)} />
      <Row label={`Tax (${Number(totals.taxRate)}%)`} value={formatAmount(totals.tax)} />
      <div className="mt-2 flex items-baseline justify-between border-t border-line-strong pt-3">
        <dt className="text-[12px] font-bold tracking-[0.08em] uppercase">Total</dt>
        <dd className="text-xl font-bold tabular-nums" data-testid={totalTestId}>
          {formatAmount(totals.total)}
        </dd>
      </div>
      {credit && (
        <>
          <Row label="Paid with store credit" value={`-${formatAmount(totals.storeCredit)}`} accent />
          <div className="flex items-baseline justify-between">
            <dt className="text-[12px] font-bold tracking-[0.08em] uppercase">Charged to card</dt>
            <dd className="font-bold tabular-nums">{formatAmount(totals.amountDue)}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${accent ? 'text-accent' : ''}`}>
      <dt className={accent ? '' : 'text-ink-2'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
