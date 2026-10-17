'use client';
// The reviews section's code (sorting, voting, the form) is not part of the product page's first load: a
// placeholder of the same shape stands in until the section is about a screen away (or the URL asks for
// #reviews), then the real section is fetched. Keeps the product page inside its JavaScript budget.
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '../ui/bits';

function Placeholder() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-16" aria-hidden>
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

const ReviewsSection = dynamic(() => import('./reviews-section').then((m) => m.ReviewsSection), {
  ssr: false,
  loading: () => (
    <section id="reviews" className="below-fold mt-24 scroll-mt-24">
      <Placeholder />
    </section>
  ),
});

export function LazyReviews(props: { slug: string; productName: string; sized: boolean }) {
  const root = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.location.hash === '#reviews' || !('IntersectionObserver' in window)) return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: '900px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (near) return <ReviewsSection {...props} />;
  return (
    <section ref={root} id="reviews" className="below-fold mt-24 scroll-mt-24" aria-label="Reviews">
      <Placeholder />
    </section>
  );
}
