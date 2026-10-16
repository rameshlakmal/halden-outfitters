import { ArrowRight, ArrowUUpLeft, CaretRight, CreditCard, Medal, Truck } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import Link from 'next/link';
import { ProductCard } from '@/components/product/product-card';
import { LinkButton } from '@/components/ui/button';
import { getCategories, getProducts } from '@/lib/server-api';
import hero from '@/public/images/banners/hero.jpg';
import kitchen from '@/public/images/banners/kitchen.jpg';

export const revalidate = 60;

const PROMISES = [
  { icon: Truck, title: 'Free shipping from 75.00', text: 'Standard delivery, counted after any discount.' },
  { icon: ArrowUUpLeft, title: '30 days to return', text: 'Counted from the day it arrives.' },
  { icon: Medal, title: 'Halden Points', text: 'One point for every 1.00 spent on gear.' },
  { icon: CreditCard, title: 'Test cards only', text: 'A demo shop for QA practice. Nothing is charged.' },
];

export default async function Home() {
  const [categories, featured, sale] = await Promise.all([
    getCategories(),
    getProducts({ featured: 'true', limit: '8' }),
    getProducts({ onSale: 'true', limit: '3' }),
  ]);

  return (
    <>
      {/* Hero: one message, centred, then the photo as a large rounded tile. */}
      <section className="mx-auto max-w-[1240px] px-4 pt-14 sm:px-6 md:pt-20 lg:px-8">
        <div className="mx-auto grid max-w-3xl justify-items-center gap-5 text-center">
          <p
            className="rise rounded-full bg-brand-soft px-3.5 py-1 text-[13px] font-semibold text-accent"
            style={{ '--i': 0 } as React.CSSProperties}
          >
            Outdoor gear for nights out
          </p>
          <h1
            className="rise text-[44px] leading-[1.02] font-bold tracking-[-0.035em] text-balance sm:text-6xl lg:text-7xl"
            style={{ '--i': 1 } as React.CSSProperties}
          >
            Light enough to forget.
          </h1>
          <p
            className="rise max-w-[46ch] text-lg leading-relaxed text-ink-2 sm:text-xl"
            style={{ '--i': 2 } as React.CSSProperties}
          >
            Tents, sleeping bags, stoves and packs that disappear into your pack and keep you warm all night.
          </p>
          <div className="rise mt-1 flex flex-wrap justify-center gap-3" style={{ '--i': 3 } as React.CSSProperties}>
            <LinkButton href="/shop" size="lg">
              Shop all gear
            </LinkButton>
            <LinkButton href="/shop?onSale=true" variant="ghost" size="lg" className="text-accent hover:text-accent">
              See what's on sale <CaretRight weight="bold" className="size-4" />
            </LinkButton>
          </div>
        </div>
        <div
          className="rise mt-12 overflow-hidden rounded-[28px] bg-surface-2"
          style={{ '--i': 4 } as React.CSSProperties}
        >
          <Image
            src={hero}
            alt="A lit tent under a starry sky at dusk"
            preload
            placeholder="blur"
            sizes="(min-width: 1240px) 1176px, 100vw"
            className="aspect-[4/3] w-full object-cover object-[30%_center] sm:aspect-[16/8] lg:aspect-[21/9]"
          />
        </div>
      </section>

      {/* Categories: Apple-style tiles, words on top, the photo below. One tile per category. */}
      {categories.length > 0 && (
        <section className="below-fold reveal mx-auto max-w-[1240px] px-4 pt-24 sm:px-6 lg:px-8" aria-labelledby="cats">
          <h2 id="cats" className="mb-8 text-center text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            Shop by what you're packing
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/shop/${c.slug}`}
                  className="group grid h-full content-between gap-6 overflow-hidden rounded-[28px] bg-surface-2 pt-9 text-center transition-colors hover:bg-surface-3"
                >
                  <div className="grid justify-items-center gap-2 px-6">
                    <h3 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{c.name}</h3>
                    <p className="max-w-[34ch] text-ink-2">{c.blurb}</p>
                    <span className="mt-1 inline-flex items-center gap-1 text-[15px] font-semibold text-accent">
                      Shop {c.productCount} products
                      <CaretRight
                        weight="bold"
                        className="size-4 transition-transform duration-300 group-hover:translate-x-1"
                      />
                    </span>
                  </div>
                  <div className="mx-6 overflow-hidden rounded-t-[22px]">
                    <Image
                      src={c.image}
                      alt=""
                      width={1200}
                      height={1200}
                      sizes="(min-width: 640px) 46vw, 92vw"
                      className="aspect-[16/10] w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Featured: a horizontal, snap-scrolling row of large tiles. */}
      <section className="below-fold reveal pt-24" aria-labelledby="featured">
        <div className="mx-auto mb-8 flex max-w-[1240px] items-end justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <h2 id="featured" className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            Trail favourites
          </h2>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1 text-[15px] font-semibold text-accent hover:underline"
          >
            Shop all <CaretRight weight="bold" className="size-4" />
          </Link>
        </div>
        <ul className="mx-auto flex max-w-[1240px] snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:px-6 lg:px-8 [&::-webkit-scrollbar]:hidden">
          {featured.items.map((p) => (
            <li key={p.id} className="w-[72%] shrink-0 snap-start sm:w-[44%] md:w-[31%] lg:w-[24%]">
              <ProductCard product={p} sizes="(min-width: 1024px) 24vw, (min-width: 768px) 31vw, 72vw" />
            </li>
          ))}
        </ul>
      </section>

      {/* One story: words and photo side by side inside a single tile. */}
      <section className="below-fold reveal mx-auto max-w-[1240px] px-4 pt-20 sm:px-6 lg:px-8">
        <div className="grid overflow-hidden rounded-[28px] bg-brand text-brand-ink md:grid-cols-2">
          <div className="grid content-center gap-4 p-8 sm:p-12 lg:p-16">
            <h2 className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Hot food, wherever you stop.</h2>
            <p className="max-w-[40ch] text-lg opacity-80">
              A stove that boils a litre in three minutes, a pot it fits inside, and a mug that keeps coffee hot for an
              hour.
            </p>
            <div className="mt-2">
              <LinkButton href="/shop/kitchen" size="lg">
                Shop the camp kitchen
              </LinkButton>
            </div>
          </div>
          <Image
            src={kitchen}
            alt="A camp stove and pot on a rock at the edge of a lake"
            placeholder="blur"
            sizes="(min-width: 768px) 620px, 100vw"
            className="h-full min-h-[280px] w-full object-cover"
          />
        </div>
      </section>

      {/* Promises: one panel, four short facts. */}
      <section className="below-fold reveal mx-auto max-w-[1240px] px-4 pt-20 sm:px-6 lg:px-8" aria-label="Buying here">
        <ul className="grid divide-y divide-line rounded-[28px] bg-surface-2 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {PROMISES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="grid content-start justify-items-center gap-2 px-6 py-8 text-center">
              <Icon className="size-7 text-accent" />
              <h3 className="font-semibold">{title}</h3>
              <p className="max-w-[26ch] text-sm text-ink-2">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Sale picks: a plain grid. */}
      {sale.items.length > 0 && (
        <section className="below-fold reveal mx-auto max-w-[1240px] px-4 pt-24 sm:px-6 lg:px-8" aria-labelledby="sale">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 id="sale" className="text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Marked down
            </h2>
            <Link
              href="/shop?onSale=true"
              className="inline-flex items-center gap-1 text-[15px] font-semibold text-accent hover:underline"
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
