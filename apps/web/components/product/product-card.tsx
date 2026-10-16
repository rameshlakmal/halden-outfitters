import type { ProductCard as Card } from '@halden/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { ViewTransition } from 'react';
import { PRODUCT_MORPH } from '@/lib/transitions';
import { AvailabilityNote, Price } from '../ui/bits';
import { QuickAdd } from './add-to-cart';

/**
 * A product in a grid. The photo carries a view-transition name, so opening the product morphs it into the
 * product page's main image.
 */
export function ProductCard({
  product,
  priority = false,
  sizes,
}: {
  product: Card;
  priority?: boolean;
  sizes?: string;
}) {
  const soldOut = product.availability.status === 'out_of_stock';
  return (
    <article className="group relative grid content-start gap-3" data-testid="product-card">
      <div className="relative overflow-hidden rounded-[16px] bg-surface-2">
        <Link href={`/products/${product.slug}`} transitionTypes={['nav-forward']} className="block">
          <ViewTransition name={`product-${product.slug}`} share={PRODUCT_MORPH} default="none">
            <Image
              src={product.image.url}
              alt={product.image.alt}
              width={product.image.width}
              height={product.image.height}
              sizes={sizes ?? '(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw'}
              loading={priority ? 'eager' : undefined}
              fetchPriority={priority ? 'high' : undefined}
              className={`aspect-[4/5] w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04] ${soldOut ? 'opacity-70 saturate-50' : ''}`}
            />
          </ViewTransition>
        </Link>
        {product.compareAtPrice && (
          <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-forest shadow-[var(--shadow-soft)]">
            Sale
          </span>
        )}
        {!soldOut && <QuickAdd productId={product.id} name={product.name} />}
      </div>
      <div className="grid gap-1 px-0.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[15px] leading-snug font-medium">
            <Link href={`/products/${product.slug}`} transitionTypes={['nav-forward']} className="hover:underline">
              {product.name}
            </Link>
          </h3>
          <Price amount={product.price} was={product.compareAtPrice} size="sm" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-3">{product.category.name}</span>
          <AvailabilityNote availability={product.availability} />
        </div>
      </div>
    </article>
  );
}
