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
      {/* Hero: the photo edge to edge, the headline set over it like a magazine cover. */}
      <section className="relative isolate flex min-h-[min(86dvh,760px)] items-end overflow-hidden bg-brand">
        <Image
          src={hero}
          alt="A lit tent under a starry sky at dusk"
          preload
          placeholder="blur"
          fill
          sizes="100vw"
          className="-z-10 object-cover object-[30%_center]"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[oklch(0.1_0_0/0.85)] via-[oklch(0.1_0_0/0.25)] to-transparent" />
        <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-4 pt-32 pb-12 text-[oklch(0.97_0_0)] sm:px-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-end lg:px-8 lg:pb-16">
          <h1
            className="rise text-[clamp(56px,11vw,168px)] leading-[0.86] tracking-[-0.01em]"
            style={{ '--i': 0 } as React.CSSProperties}
          >
            Gear that earns its place.
          </h1>
          <div className="rise grid gap-5 md:pb-3" style={{ '--i': 1 } as React.CSSProperties}>
            <p className="max-w-[38ch] text-lg leading-relaxed text-[oklch(0.88_0_0)]">
              Tents, sleeping bags, stoves and packs, picked for long nights out and light enough to carry all day.
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/shop" size="lg" className="uppercase tracking-[0.06em]">
                Shop all gear <ArrowRight className="size-5" />
              </LinkButton>
              <LinkButton href="/shop?onSale=true" variant="inverse" size="lg" className="tracking-[0.06em] uppercase">
                On sale
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {/* Categories: four tall photo columns, edge to edge, the name set large at the foot of each. */}
      {categories.length > 0 && (
        <section className="below-fold reveal pt-20" aria-labelledby="cats">
          <div className="mx-auto mb-8 flex max-w-[1400px] items-end justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <h2 id="cats" className="text-5xl sm:text-7xl">
              Shop by kit
            </h2>
            <Link href="/shop" className="link inline-flex items-center gap-1 text-[13px] tracking-[0.08em] uppercase">
              Everything <CaretRight weight="bold" className="size-4" />
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-px bg-line-strong lg:grid-cols-4">
            {categories.map((c) => (
              <li key={c.slug} className="bg-bg">
                <Link
                  href={`/shop/${c.slug}`}
                  className="group relative isolate flex aspect-[3/4] flex-col justify-end overflow-hidden p-5 text-[oklch(0.97_0_0)] sm:p-7"
                >
                  <Image
                    src={c.image}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    className="-z-10 object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.06]"
                  />
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[oklch(0.1_0_0/0.8)] to-transparent to-60%" />
                  <h3 className="text-3xl leading-none font-extrabold uppercase [font-stretch:72%] sm:text-5xl">
                    {c.name}
                  </h3>
                  <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold tracking-[0.08em] uppercase transition-colors group-hover:text-accent">
                    {c.productCount} products{' '}
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </span>
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
          <Link href="/shop" className="inline-flex items-center gap-1 text-[15px] font-semibold link">
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
        <div className="grid overflow-hidden rounded-[2px] bg-brand text-brand-ink md:grid-cols-2">
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
        <ul className="grid divide-y divide-line rounded-[2px] bg-surface-2 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
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
            <Link href="/shop?onSale=true" className="inline-flex items-center gap-1 text-[15px] font-semibold link">
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
