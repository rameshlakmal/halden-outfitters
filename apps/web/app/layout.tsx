import { GeistSans } from 'geist/font/sans';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { Footer } from '@/components/shell/footer';
import { THEME_SCRIPT } from '@/components/shell/theme';
import { TopBar } from '@/components/shell/top-bar';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3001'),
  title: { default: 'Halden Outfitters', template: '%s | Halden Outfitters' },
  description: 'Outdoor gear for nights out: tents, sleeping bags, stoves and packs. A demo shop for QA testing.',
  openGraph: { siteName: 'Halden Outfitters', images: ['/images/banners/hero.jpg'] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8f6' },
    { media: '(prefers-color-scheme: dark)', color: '#141a17' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only rounded-full bg-forest px-4 py-2 text-forest-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70]"
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
