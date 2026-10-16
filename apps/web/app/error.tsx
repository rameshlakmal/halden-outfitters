'use client';
import { CloudWarning } from '@phosphor-icons/react';
import { Button, LinkButton } from '@/components/ui/button';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto grid max-w-xl justify-items-center gap-4 px-4 py-28 text-center">
      <CloudWarning className="size-14 text-ink-3" weight="thin" />
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong on our side</h1>
      <p className="text-ink-2">Try again in a moment. If it keeps happening, this reference helps us find it.</p>
      {error.digest && (
        <code className="rounded-md bg-surface-2 px-2 py-1 font-mono text-sm text-ink-2">{error.digest}</code>
      )}
      <div className="mt-2 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <LinkButton href="/" variant="outline">
          Home
        </LinkButton>
      </div>
    </div>
  );
}
