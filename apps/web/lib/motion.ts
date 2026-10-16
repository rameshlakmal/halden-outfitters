'use client';
// Motion without a library: CSS transitions, @starting-style, the Web Animations API and View Transitions.
// All of it is built into the browser (no JavaScript to download), runs on transform and opacity only, and
// collapses to instant changes for visitors who ask for reduced motion or whose device is low-end.
import { flushSync } from 'react-dom';
import { useSyncExternalStore } from 'react';

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** A spring (slight overshoot, settles) expressed as a CSS linear() easing, so it needs no physics engine. */
export const SPRING =
  'linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 20.4%, 1.067 24.1%, 1.073 26.4%, 1.064 29.2%, 1.006 37.6%, 0.99 42.7%, 0.997 53.2%, 1.001 66.6%, 1)';

type NavigatorExtras = Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };

/** Reduced motion asked for, or a low-end / data-saving device: change things instantly instead. */
export function liteMotion(): boolean {
  if (typeof window === 'undefined') return true;
  const n = navigator as NavigatorExtras;
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (n.hardwareConcurrency ?? 8) <= 4 ||
    n.connection?.saveData === true ||
    (n.deviceMemory ?? 8) <= 2
  );
}

export function useLiteMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    liteMotion,
    () => true,
  );
}

/** Runs a Web Animation and resolves when it ends (immediately in lite mode). */
export function animate(el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (!el || liteMotion() || typeof el.animate !== 'function') return Promise.resolve();
  return el
    .animate(keyframes, { easing: EASE_OUT, fill: 'none', ...options })
    .finished.then(() => undefined)
    .catch(() => undefined);
}

/**
 * Applies a React state change inside a native view transition, so elements with a view-transition-name
 * glide from their old place to the new one (e.g. cart lines closing a gap). Falls back to a plain update.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || liteMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

/** Slides an element out (towards the right), then resolves. Used before removing a list item. */
export const slideOut = (el: Element | null) =>
  animate(
    el,
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'translateX(24px)' },
    ],
    {
      duration: 180,
      fill: 'forwards',
    },
  );

/** A short bounce on a counter or badge: feedback that something was added. */
export const bounce = (el: Element | null) =>
  animate(el, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], {
    duration: 460,
    easing: SPRING,
  });
