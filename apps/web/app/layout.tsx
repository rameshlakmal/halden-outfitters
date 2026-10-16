import { Manrope } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { Footer } from '@/components/shell/footer';
import { BOOT_SCRIPT } from '@/lib/boot-script';
import { TopBar } from '@/components/shell/top-bar';
import './globals.css';

// Self-hosted at build time (no request to Google at runtime). One variable file covers every weight.
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3001'),
  title: { default: 'Halden Outfitters', template: '%s | Halden Outfitters' },
  description: 'Outdoor gear for nights out: tents, sleeping bags, stoves and packs. A demo shop for QA testing.',
  openGraph: { siteName: 'Halden Outfitters', images: ['/images/banners/hero.jpg'] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0f141d' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only rounded-full bg-brand px-4 py-2 text-brand-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]"
        >
          Skip to content
        </a>
        <Providers>
          <TopBar />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
