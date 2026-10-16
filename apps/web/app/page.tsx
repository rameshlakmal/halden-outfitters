import { ArrowRight, ArrowUUpLeft, CreditCard, Medal, Truck } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { ProductCard } from '@/components/product/product-card';
import { LinkButton } from '@/components/ui/button';
import { getCategories, getProducts } from '@/lib/server-api';
import hero from '@/public/images/banners/hero.jpg';
import kitchen from '@/public/images/banners/kitchen.jpg';

export const revalidate = 60;

const PROMISES = [
  {
    icon: Truck,
    title: 'Free standard shipping from 75.00',
    text: 'Counted after any discount. Europe ships free from 150.00.',
  },
  {
    icon: ArrowUUpLeft,
    title: '30 days to change your mind',
    text: 'Counted from the day it arrives, not the day you order.',
  },
  {
    icon: Medal,
    title: 'Halden Points on every order',
    text: 'One point for every 1.00 spent on gear, worth money off later.',
  },
  { icon: CreditCard, title: 'Test cards only', text: 'This is a demo shop for QA practice. Nothing is ever charged.' },
];

export default async function Home() {
  const [categories, featured, sale] = await Promise.all([
    getCategories(),
    getProducts({ featured: 'true', limit: '8' }),
    getProducts({ onSale: 'true', limit: '3' }),
  ]);
  const [big, wide, ...small] = categories;

  return (
    <>
      {/* Hero: asymmetric split, the photo does the talking. */}
      <section className="mx-auto grid max-w-[1400px] items-center gap-10 px-4 pt-8 pb-16 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:pt-12 lg:gap-16 lg:px-8">
        <div className="grid content-center gap-6">
          <p className="rise text-sm font-medium text-forest" style={{ '--i': 0 } as React.CSSProperties}>
            Outdoor gear for nights out
          </p>
          <h1
            className="rise max-w-[14ch] text-5xl leading-[1.04] font-semibold tracking-tight text-balance lg:text-6xl"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            Gear that earns its place in your pack.
          </h1>
          <p
            className="rise max-w-[42ch] text-lg leading-relaxed text-ink-2"
            style={{ '--i': 2 } as React.CSSProperties}
          >
            Tents, sleeping bags, stoves and packs, picked for long nights out and light enough to carry all day.
          </p>
          <div className="rise flex flex-wrap gap-3" style={{ '--i': 3 } as React.CSSProperties}>
            <LinkButton href="/shop" size="lg">
              Shop all gear <ArrowRight className="size-5" />
            </LinkButton>
            <LinkButton href="/shop?onSale=true" variant="outline" size="lg">
              See what's on sale
            </LinkButton>
          </div>
        </div>
        <div className="relative">
          <Image
            src={hero}
            alt="A lit tent under a starry sky at dusk"
            preload
            placeholder="blur"
            sizes="(min-width: 768px) 52vw, 100vw"
            className="aspect-[4/3] w-full rounded-[16px] object-cover object-[22%_center] md:aspect-[5/6] lg:aspect-[4/4.2]"
          />
        </div>
      </section>

      {/* Categories: a bento with exactly one cell per category, each with its own photo. */}
      {big && wide && (
        <section className="below-fold reveal mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-8" aria-labelledby="cats">
          <h2 id="cats" className="mb-8 text-3xl font-semibold tracking-tight md:text-4xl">
            Shop by what you're packing
          </h2>
          <div className="grid gap-4 md:h-[640px] md:grid-cols-4 md:grid-rows-2">
            <CategoryTile category={big} className="md:col-span-2 md:row-span-2" large />
            <CategoryTile category={wide} className="md:col-span-2" />
            {small.map((c) => (
              <CategoryTile key={c.slug} category={c} className="md:col-span-1" />
            ))}
          </div>
        </section>
      )}

      {/* Featured: a horizontal, snap-scrolling row. */}
      <section className="below-fold reveal py-12" aria-labelledby="featured">
        <div className="mx-auto mb-8 flex max-w-[1400px] items-end justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <h2 id="featured" className="text-3xl font-semibold tracking-tight md:text-4xl">
            Trail favourites
          </h2>
          <Link href="/shop" className="inline-flex items-center gap-1 text-sm font-medium text-forest hover:underline">
            Shop all <ArrowRight className="size-4" />
          </Link>
        </div>
        <ul className="mx-auto flex max-w-[1400px] snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:thin] sm:px-6 lg:px-8">
          {featured.items.map((p) => (
            <li key={p.id} className="w-[68%] shrink-0 snap-start sm:w-[42%] md:w-[30%] xl:w-[23.5%]">
              <ProductCard product={p} sizes="(min-width: 1280px) 24vw, (min-width: 768px) 30vw, 68vw" />
            </li>
          ))}
        </ul>
      </section>

      {/* A full-bleed photo band for one story. */}
      <section className="below-fold reveal mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="relative isolate overflow-hidden rounded-[16px]">
          <Image
            src={kitchen}
            alt="A camp stove and pot on a rock at the edge of a lake"
            placeholder="blur"
            sizes="(min-width: 1400px) 1340px, 100vw"
            className="absolute inset-0 -z-10 h-full w-full object-cover"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[oklch(0.18_0.02_160/0.82)] via-[oklch(0.18_0.02_160/0.45)] to-transparent" />
          <div className="grid max-w-xl gap-4 px-6 py-16 text-[oklch(0.97_0.005_150)] sm:px-12 md:py-24">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Hot food, wherever you stop</h2>
            <p className="text-lg text-[oklch(0.9_0.01_150)]">
              A stove that boils a litre in three minutes, a pot it fits inside, and a mug that keeps coffee hot for an
              hour.
            </p>
            <div>
              <LinkButton href="/shop/kitchen" size="lg">
                Shop the camp kitchen
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* Promises: a split list, not a row of identical cards. */}
      <section className="below-fold reveal mx-auto grid max-w-[1400px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:px-8">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Buying here, simply put</h2>
        <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {PROMISES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="grid content-start gap-2">
              <Icon className="size-7 text-forest" />
              <h3 className="font-semibold">{title}</h3>
              <p className="text-ink-2">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Sale picks: a plain grid. */}
      {sale.items.length > 0 && (
        <section className="below-fold reveal mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-8" aria-labelledby="sale">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 id="sale" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Marked down
            </h2>
            <Link
              href="/shop?onSale=true"
              className="inline-flex items-center gap-1 text-sm font-medium text-forest hover:underline"
            >
              All sale items <ArrowRight className="size-4" />
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3">
            {sale.items.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} sizes="(min-width: 768px) 33vw, 50vw" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CategoryTile({
  category,
  className,
  large = false,
}: {
  category: { slug: string; name: string; blurb: string; image: string; productCount: number };
  className: string;
  large?: boolean;
}) {
  return (
    <Link
      href={`/shop/${category.slug}`}
      className={`group relative isolate flex min-h-[220px] flex-col justify-end overflow-hidden rounded-[16px] p-6 text-[oklch(0.97_0.005_150)] ${className}`}
    >
      <Image
        src={category.image}
        alt=""
        fill
        sizes={large ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 768px) 25vw, 100vw'}
        className="-z-10 object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05]"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[oklch(0.16_0.02_160/0.85)] via-[oklch(0.16_0.02_160/0.25)] to-transparent" />
      <h3 className={`font-semibold tracking-tight ${large ? 'text-3xl' : 'text-xl'}`}>{category.name}</h3>
      <p className={`mt-1 max-w-[36ch] text-[oklch(0.9_0.01_150)] ${large ? 'text-base' : 'text-sm'}`}>
        {category.blurb}
      </p>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
        {category.productCount} products{' '}
        <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}
