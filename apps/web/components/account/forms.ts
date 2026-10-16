'use client';
import { useSyncExternalStore } from 'react';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api';

/**
 * The ?next= target of an auth page, without useSearchParams: reading it from window.location keeps the
 * form in the prerendered HTML (useSearchParams would render it on the client only, shifting the layout).
 */
export function useNextParam(): string {
  return useSyncExternalStore(
    () => () => {},
    () => safeNext(new URLSearchParams(window.location.search).get('next')),
    () => '/account',
  );
}

/** Only same-site paths: "/account" is fine, "//evil.example" and "https://..." are not. */
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}

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

/**
 * Puts the API's per-field messages onto the form's fields. Returns the message to show above the form when
 * the error isn't only about fields we know, or null when every problem landed on a field.
 */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
    let unplaced = false;
    for (const [path, message] of Object.entries(err.fields)) {
      if (fields.includes(path)) setError(path as Path<T>, { type: 'server', message });
      else unplaced = true;
    }
    return unplaced || err.code !== 'validation_failed' ? errorMessage(err) : null;
  }
  return errorMessage(err);
}
