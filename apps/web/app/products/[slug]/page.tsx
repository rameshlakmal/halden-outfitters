import { ArrowLeft, ArrowUUpLeft, Prohibit, Truck } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { BuyBox } from '@/components/product/add-to-cart';
import { Gallery } from '@/components/product/gallery';
import { ProductCard } from '@/components/product/product-card';
import { AvailabilityNote, Price, Stars } from '@/components/ui/bits';
import { getProduct, getProducts } from '@/lib/server-api';
import { PAGE_ENTER } from '@/lib/transitions';

type Props = { params: Promise<{ slug: string }> };

export const revalidate = 60;

/** Every product page is built ahead of time and refreshed in the background. */
export async function generateStaticParams() {
  const page = await getProducts({ limit: '48' });
  return page.items.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  return {
    title: p.name,
    description: p.summary,
    openGraph: { images: [p.image.url] },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await getProduct((await params).slug);
  const details = product.details;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">
      <nav aria-label="Breadcrumb" className="mb-6">
        <Link
          href={`/shop/${product.category.slug}`}
          transitionTypes={['nav-back']}
          className="inline-flex items-center gap-1.5 rounded-full py-1 pr-3 text-sm text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="size-4" /> {product.category.name}
        </Link>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <Gallery product={product} />

        <ViewTransition enter={PAGE_ENTER} default="none">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="grid gap-5">
              <div className="grid gap-3">
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{product.name}</h1>
                <Stars average={product.rating.average} count={product.rating.count} />
              </div>
              <p className="max-w-[52ch] text-lg leading-relaxed text-ink-2">{product.summary}</p>
              <div className="flex items-center justify-between gap-4 border-y border-line py-4">
                <Price amount={product.price} was={product.compareAtPrice} size="lg" />
                <AvailabilityNote availability={product.availability} />
              </div>
              <BuyBox product={product} />
              <ul className="grid gap-3 pt-2 text-sm text-ink-2">
                <li className="flex items-center gap-3">
                  <Truck className="size-5 text-forest" /> Free standard shipping on orders from 75.00
                </li>
                {product.returnable ? (
                  <li className="flex items-center gap-3">
                    <ArrowUUpLeft className="size-5 text-forest" /> 30 days to return it, counted from delivery
                  </li>
                ) : (
                  <li className="flex items-center gap-3">
                    <Prohibit className="size-5 text-ink-3" /> Final sale: this item can't be returned
                  </li>
                )}
              </ul>
              <p className="text-[13px] text-ink-3">SKU {product.sku}</p>
            </div>
          </div>
        </ViewTransition>
      </div>

      <section
        className="below-fold reveal mt-20 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16"
        aria-labelledby="about"
      >
        <div className="grid content-start gap-4">
          <h2 id="about" className="text-2xl font-semibold tracking-tight">
            About the {product.name}
          </h2>
          <p className="max-w-[65ch] leading-relaxed text-ink-2">{product.description}</p>
        </div>
        {details.length > 0 && (
          <dl className="grid grid-cols-2 gap-3 self-start">
            {details.map(([label, value], i) => (
              <div
                key={label}
                className={`grid gap-1 rounded-[16px] p-5 ${i === 0 ? 'col-span-2 bg-forest text-forest-ink sm:col-span-1' : 'bg-surface-2'}`}
              >
                <dt className={`text-sm ${i === 0 ? 'opacity-80' : 'text-ink-3'}`}>{label}</dt>
                <dd className="text-xl font-semibold tracking-tight">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {product.related.length > 0 && (
        <section className="below-fold reveal mt-24" aria-labelledby="related">
          <div className="mb-8 flex items-end justify-between gap-4">
            <h2 id="related" className="text-2xl font-semibold tracking-tight">
              More {product.category.name.toLowerCase()}
            </h2>
            <Link href={`/shop/${product.category.slug}`} className="text-sm font-medium text-forest hover:underline">
              See all
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
            {product.related.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} sizes="(min-width: 768px) 25vw, 50vw" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
