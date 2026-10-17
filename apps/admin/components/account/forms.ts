import { ApiError } from '@/lib/api';

/** A sentence for an error that isn't about one field. */
export function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (err.code === 'account_locked' || err.code === 'rate_limited') {
    const minutes = Math.max(1, Math.ceil((err.retryAfterSeconds ?? 60) / 60));
    return err.code === 'account_locked'
      ? `Too many wrong passwords. Sign-in is paused for ${minutes} more minute${minutes === 1 ? '' : 's'}. You can reset your password now instead.`
      : `Too many attempts. Please wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`;
  }
  return err.message;
}
