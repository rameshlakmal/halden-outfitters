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
      <span className="grid size-8 place-items-center rounded-full bg-forest text-forest-ink">
        <Mountains weight="fill" className="size-[18px]" />
      </span>
      <span className="text-[19px] font-semibold tracking-tight">Halden</span>
    </Link>
  );
}
