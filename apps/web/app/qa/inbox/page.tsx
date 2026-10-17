import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inbox } from '@/components/account/inbox';

export const metadata: Metadata = { title: 'Fake inbox', robots: { index: false } };

export default function InboxPage() {
 return (
 <div className="mx-auto grid max-w-[1200px] gap-8 px-[var(--gutter)] pt-8 md:pt-14">
 <header className="grid max-w-2xl gap-3">
 <p className="text-sm font-medium text-brand">QA lab</p>
 <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Fake inbox</h1>
 <p className="leading-relaxed text-ink-2">
 This demo shop never sends real email. Every message it would send lands here instead, so you can follow
 confirmation and password reset links while testing.
 </p>
 <p className="leading-relaxed text-ink-2">
 Register with an address at a test domain such as <code>you@halden.test</code> or <code>you@example.com</code>
 and anyone can read its mail here. Mail to any other address is shown only to its owner, signed in.
 </p>
 </header>
 <Suspense>
 <Inbox />
 </Suspense>
 </div>
 );
}
