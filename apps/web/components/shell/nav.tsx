import { Mountains } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';

export const NAV = [
  { href: '/shop', label: 'Shop all' },
  { href: '/shop/shelter', label: 'Shelter' },
  { href: '/shop/sleep', label: 'Sleep' },
  { href: '/shop/kitchen', label: 'Kitchen' },
  { href: '/shop/carry', label: 'Packs' },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-ink" aria-label="Halden Outfitters, home">
      <Mountains weight="fill" className="size-6 text-accent" />
      <span className="text-[26px] leading-none font-extrabold uppercase [font-stretch:72%]">Halden</span>
    </Link>
  );
}
