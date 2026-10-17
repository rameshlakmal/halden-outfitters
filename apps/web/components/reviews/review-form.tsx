'use client';
// Write or edit a review. Loaded only when the shopper opens it, so the product page doesn't carry it.
// The checks mirror the API (1 to 5 stars, title 5 to 80, body 20 to 2000); the API's answer is final.
import type { OwnReview } from '@halden/contracts';
import { Star } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ApiError, post, put } from '@/lib/api';
import { FIT_LABEL, type Fit, type ReviewDraft, reviewKeys } from '@/lib/reviews';
import { errorMessage } from '../account/forms';
import { Button } from '../ui/button';
import { Field, FormAlert, Input } from '../ui/field';

type Errors = Partial<Record<'rating' | 'title' | 'body' | 'fit' | 'form', string>>;

const STAR_WORDS = ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

function StarPicker({ value, onChange, error }: { value: number; onChange: (n: number) => void; error?: string }) {
  const name = useId();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <fieldset className="grid gap-1.5" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="mb-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">Your rating</legend>
      <div className="flex items-center gap-3" onPointerLeave={() => setHover(0)}>
        <div className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              onPointerEnter={() => setHover(n)}
              className="grid size-10 cursor-pointer place-items-center rounded-[2px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent pointer-coarse:size-11"
            >
              <input
                type="radio"
                name={name}
                value={n}
                checked={value === n}
                onChange={() => onChange(n)}
                className="sr-only"
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
              />
              <Star
                weight={shown >= n ? 'fill' : 'regular'}
                className={`size-7 transition-transform duration-150 ${shown >= n ? 'text-accent' : 'text-ink-3'} ${hover === n ? 'scale-110' : ''}`}
                aria-hidden="true"
              />
            </label>
          ))}
        </div>
        <span className="text-[14px] font-semibold text-ink-2" aria-live="polite">
          {STAR_WORDS[shown]}
        </span>
      </div>
      {error && (
        <p id={`${name}-error`} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export default function ReviewForm({
  slug,
  sized,
  editing,
  onDone,
  onCancel,
}: {
  slug: string;
  sized: boolean;
  /** The review being edited; leave out to write a new one. */
  editing?: { id: string } & ReviewDraft;
  onDone: (review: OwnReview) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ReviewDraft>(
    editing
      ? { rating: editing.rating, title: editing.title, body: editing.body, fit: editing.fit }
      : { rating: 0, title: '', body: '', fit: null },
  );
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ReviewDraft>(k: K, v: ReviewDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const check = (): Errors => {
    const e: Errors = {};
    if (draft.rating < 1) e.rating = 'Choose 1 to 5 stars.';
    const title = draft.title.trim();
    if (title.length < 5) e.title = 'At least 5 characters.';
    else if (title.length > 80) e.title = 'At most 80 characters.';
    const body = draft.body.trim();
    if (body.length < 20) e.body = 'At least 20 characters.';
    else if (body.length > 2000) e.body = 'At most 2000 characters.';
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = check();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = {
      rating: draft.rating,
      title: draft.title.trim(),
      body: draft.body.trim(),
      fit: sized ? draft.fit : null,
    };
    try {
      const saved = editing
        ? await put<OwnReview>(`/reviews/${editing.id}`, body)
        : await post<OwnReview>(`/products/${slug}/reviews`, body);
      void qc.invalidateQueries({ queryKey: reviewKeys.all });
      onDone(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation_failed' && Object.keys(err.fields).length) {
        const f = err.fields;
        setErrors({ rating: f.rating, title: f.title, body: f.body, fit: f.fit });
      } else {
        // review_not_allowed (403), already_reviewed (409), edit window over (409): say it above the form.
        setErrors({ form: errorMessage(err) });
      }
    } finally {
      setBusy(false);
    }
  };

  const bodyLength = draft.body.trim().length;
  return (
    <form
      onSubmit={submit}
      noValidate
      className="grid gap-5 rounded-[2px] border border-ink bg-surface p-5 sm:p-6"
      aria-label={editing ? 'Edit your review' : 'Write a review'}
    >
      <h3 className="text-xl">{editing ? 'Edit your review' : 'Write a review'}</h3>
      {errors.form && <FormAlert>{errors.form}</FormAlert>}
      <StarPicker value={draft.rating} onChange={(n) => set('rating', n)} error={errors.rating} />
      <Input
        label="Title"
        value={draft.title}
        maxLength={80}
        onChange={(e) => set('title', e.target.value)}
        error={errors.title}
        hint="Sum it up in a few words."
      />
      <Field
        label="Review"
        error={errors.body}
        hint={
          <span className="flex justify-between gap-3">
            <span>What did you use it for, and how did it do?</span>
            <span className={`tabular-nums ${bodyLength > 2000 ? 'text-danger' : ''}`}>{bodyLength}/2000</span>
          </span>
        }
      >
        {(p) => (
          <textarea
            {...p}
            rows={5}
            value={draft.body}
            onChange={(e) => set('body', e.target.value)}
            className={`${p.className} min-h-32 py-2.5 leading-relaxed`}
          />
        )}
      </Field>
      {sized && (
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[12px] font-bold tracking-[0.08em] uppercase">
            How does it fit? <span className="font-semibold tracking-normal text-ink-3 normal-case">optional</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FIT_LABEL) as Fit[]).map((f) => (
              <label
                key={f}
                className={`press inline-flex min-h-11 cursor-pointer items-center rounded-[2px] border px-4 text-[13px] font-bold tracking-[0.06em] uppercase has-[:focus-visible]:outline-2 ${
                  draft.fit === f ? 'border-ink bg-ink text-bg' : 'border-line-strong hover:border-ink-3'
                }`}
              >
                <input
                  type="radio"
                  name="fit"
                  value={f}
                  checked={draft.fit === f}
                  onChange={() => set('fit', f)}
                  onClick={() => draft.fit === f && set('fit', null)}
                  className="sr-only"
                />
                {FIT_LABEL[f]}
              </label>
            ))}
          </div>
          {errors.fit && <p className="text-[13px] font-medium text-danger">{errors.fit}</p>}
        </fieldset>
      )}
      <p className="text-[13px] text-ink-3">
        Reviews with links, email addresses or rude words wait for a quick check before they appear.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={busy}>
          {editing ? 'Save changes' : 'Post review'}
        </Button>
      </div>
    </form>
  );
}
