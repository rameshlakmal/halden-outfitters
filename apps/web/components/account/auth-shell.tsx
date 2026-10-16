import Image from 'next/image';
import type { ReactNode } from 'react';

type Photo = { src: string; alt: string };

/** Sign-in style pages: the form on the left, a full-height photo on the right (hidden on small screens). */
export function AuthShell({
  title,
  intro,
  photo,
  children,
}: {
  title: string;
  intro?: ReactNode;
  photo: Photo;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-10 px-[var(--gutter)] pt-8 pb-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:pt-12 lg:gap-16">
      <div className="grid content-start gap-8 md:py-10 lg:pl-8">
        <div className="rise grid max-w-md gap-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          {intro && <p className="leading-relaxed text-ink-2">{intro}</p>}
        </div>
        <div className="rise w-full max-w-md" style={{ '--i': 1 } as React.CSSProperties}>
          {children}
        </div>
      </div>
      <div className="relative hidden min-h-[560px] overflow-hidden rounded-[2px] bg-surface-2 md:block">
        <Image
          src={photo.src}
          alt={photo.alt}
          fill
          sizes="(min-width: 768px) 52vw, 1px"
          className="object-cover"
          preload
        />
      </div>
    </div>
  );
}
