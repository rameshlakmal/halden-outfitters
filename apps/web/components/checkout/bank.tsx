'use client';
// The HaldenPay test bank: the page a card with a bank step sends you to. In real life this is your bank's
// site, so it is drawn plainly and apart from the shop. Approve or decline, then back to the shop.
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { ApiError, post } from '@/lib/api';
import { orderKeys } from '@/lib/orders';
import { Spinner } from '../ui/button';

/** The ?token= of the link, without useSearchParams (which would render this on the client only). */
function useToken(): string | null | undefined {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('token'),
    () => undefined,
  );
}

const btn =
  'press inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[6px] px-5 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2';

export function TestBank() {
  const token = useToken();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (approve: boolean) => {
    if (!token) return;
    setBusy(approve ? 'approve' : 'decline');
    setError(null);
    try {
      const r = await post<{ orderId: string; status: string }>('/payments/authenticate', { token, approve });
      await qc.invalidateQueries({ queryKey: orderKeys.all });
      router.replace(`/checkout/confirmation/${r.orderId}`);
    } catch (err) {
      setBusy(null);
      setError(
        err instanceof ApiError && err.status === 410
          ? 'This request has expired or was already answered. Check the order in your account.'
          : err instanceof ApiError
            ? err.message
            : 'The bank could not be reached. Please try again.',
      );
    }
  };

  return (
    <div className="rise overflow-hidden rounded-[6px] border border-line-strong bg-surface font-sans normal-case shadow-[0_8px_28px_oklch(0_0_0/0.12)]">
      <div className="flex items-center justify-between gap-3 bg-[oklch(0.3_0.02_250)] px-5 py-3 text-[oklch(0.97_0_0)]">
        <span className="text-[15px] font-semibold tracking-normal">HaldenPay test bank</span>
        <span className="rounded-[4px] border border-[oklch(0.97_0_0/0.4)] px-2 py-0.5 text-[11px] font-medium">
          Test mode
        </span>
      </div>
      <div className="grid gap-5 px-5 py-6 sm:px-6">
        <div className="grid gap-2">
          <h1 className="font-sans text-[22px] font-semibold tracking-normal normal-case">Confirm this payment</h1>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Halden Outfitters asked to hold money on your card. In a real shop your bank would ask for a code or an app
            tap here. This test bank lets you choose the answer.
          </p>
        </div>

        {token === undefined ? (
          <div className="h-12" />
        ) : token === null ? (
          <p role="alert" className="rounded-[6px] bg-danger-soft px-4 py-3 text-[14px] text-danger">
            This link is missing its payment reference. Open it again from checkout.
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" className="rounded-[6px] bg-danger-soft px-4 py-3 text-[14px] text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className={`${btn} bg-[oklch(0.45_0.12_150)] text-[oklch(0.99_0_0)] hover:bg-[oklch(0.4_0.12_150)]`}
                onClick={() => answer(true)}
                disabled={busy !== null}
              >
                {busy === 'approve' && <Spinner />} Approve
              </button>
              <button
                type="button"
                className={`${btn} border border-line-strong bg-surface text-ink hover:bg-surface-2`}
                onClick={() => answer(false)}
                disabled={busy !== null}
              >
                {busy === 'decline' && <Spinner />} Decline
              </button>
            </div>
          </>
        )}
        <p className="text-[13px] text-ink-3">If you do neither, the shop cancels the order after a few minutes.</p>
      </div>
    </div>
  );
}
