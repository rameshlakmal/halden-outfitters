'use client';
// Product photos. The first one shares its view-transition name with the product card, so it morphs in from
// the grid. With several photos, the strip is a native CSS scroll-snap carousel: swiping is the browser's own
// gesture (smooth on every phone, no JavaScript physics), and the thumbnails scroll to a photo.
import type { Product } from '@halden/contracts';
import Image from 'next/image';
import { useRef, useState, ViewTransition } from 'react';
import { liteMotion } from '@/lib/motion';
import { PRODUCT_MORPH } from '@/lib/transitions';

export function Gallery({ product }: { product: Pick<Product, 'slug' | 'name' | 'images'> }) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const images = product.images;
  const many = images.length > 1;

  const go = (i: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: liteMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div className="grid gap-3">
      <div
        ref={strip}
        onScrollEnd={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[2px] bg-surface-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={many ? `Photos of ${product.name}, swipe for more` : undefined}
      >
        {images.map((img, i) => (
          <div key={img.url} className="w-full shrink-0 snap-center">
            {i === 0 ? (
              <ViewTransition name={`product-${product.slug}`} share={PRODUCT_MORPH} default="none">
                <Image
                  src={img.url}
                  alt={img.alt}
                  width={img.width}
                  height={img.height}
                  sizes="(min-width: 1024px) 55vw, 100vw"
                  preload
                  className="aspect-square w-full object-cover"
                />
              </ViewTransition>
            ) : (
              <Image
                src={img.url}
                alt={img.alt}
                width={img.width}
                height={img.height}
                sizes="(min-width: 1024px) 55vw, 100vw"
                className="aspect-square w-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {many && (
        <div className="flex gap-2" role="tablist" aria-label={`Photos of ${product.name}`}>
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Photo ${i + 1} of ${images.length}`}
              onClick={() => go(i)}
              className={`press overflow-hidden rounded-[2px] border-2 ${i === index ? 'border-brand' : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              <Image src={img.url} alt="" width={72} height={72} sizes="72px" className="size-[72px] object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
