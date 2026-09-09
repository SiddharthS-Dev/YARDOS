import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'YARDOS — Sri JP Smartpark',
    template: '%s · YARDOS',
  },
  description:
    'Vehicle yard, parking, billing, auction and financier-intelligence platform.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F1F3EF' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F12' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. Without this the page
            renders light and snaps to dark on hydration, which on a gate
            screen at night is briefly blinding. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
