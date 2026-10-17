// Small pieces shared by the return pages: the status chip and the plain-words policy.
import type { ReturnStatus } from '@halden/contracts';
import { LABEL_FEE, RESTOCKING_PERCENT, RETURN_STATUS_LABEL } from '@/lib/returns';
import { chipClass } from '../orders/status';

const TONE: Record<ReturnStatus, string> = {
  requested: 'border-accent text-accent',
  approved: 'border-line bg-ink text-bg',
  rejected: 'border-danger/40 text-danger',
  received: 'border-line text-ink',
  refunded: 'border-line text-ink-2',
  partially_refunded: 'border-line text-ink',
  expired: 'border-line text-ink-3',
  cancelled: 'border-line text-ink-3 line-through decoration-1',
};

export function ReturnChip({ status }: { status: ReturnStatus }) {
  return <span className={chipClass(TONE[status])}>{RETURN_STATUS_LABEL[status]}</span>;
}

export function ReturnPolicy() {
  return (
    <aside
      aria-label="Return policy"
      className="grid content-start gap-3 rounded-[var(--radius-field)] border border-line bg-surface p-5"
    >
      <h2 className="text-[13px] font-medium">How returns work</h2>
      <ul className="grid gap-2.5 text-[14px] leading-relaxed text-ink-2">
        <li>You have 30 days from delivery to start a return.</li>
        <li>
          Damaged, wrong or not as described: the label is free, and we refund shipping too when you send back the whole
          order.
        </li>
        <li>Any other reason: {LABEL_FEE} for the label comes off the refund.</li>
        <li>
          Items that come back opened have a {RESTOCKING_PERCENT}% restocking fee, unless the problem was ours. Items
          damaged after delivery are not refunded.
        </li>
        <li>
          Store credit is ready the moment we check your parcel. A card refund goes back to the card you paid with.
        </li>
        <li>Points you used come back as points.</li>
      </ul>
    </aside>
  );
}
