import Link from 'next/link';
import { Logo, NAV } from './nav';

const HELP = [
  { href: '/help/shipping', label: 'Shipping' },
  { href: '/help/returns', label: 'Returns' },
  { href: '/account', label: 'Your account' },
];

const QA = [
  { href: '/qa/inbox', label: 'Fake inbox' },
  { href: '/api/v1/docs', label: 'API reference' },
];

export function Footer() {
  return (
    <footer className="below-fold mt-24 border-t border-line bg-surface [contain-intrinsic-size:auto_420px]">
      <div className="mx-auto grid max-w-[1400px] gap-10 px-[var(--gutter)] py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="grid content-start gap-4">
          <Logo />
          <p className="max-w-[36ch] text-sm leading-relaxed text-ink-2">
            Halden Outfitters is a demo shop built as a test target for QA. Nothing is for sale, and payments use test
            cards only.
          </p>
        </div>
        <FooterList title="Shop" links={NAV} />
        <FooterList title="Help" links={HELP} />
        <FooterList title="For testers" links={QA} />
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-[1400px] px-[var(--gutter)] py-5 text-[13px] text-ink-3 ">
          Photos from Pexels and Unsplash, credited in the repository. Made for practising database and API testing.
        </p>
      </div>
    </footer>
  );
}

function FooterList({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <ul className="grid gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              prefetch={false}
              className="inline-flex items-center text-sm text-ink-2 hover:text-accent pointer-coarse:min-h-11"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
