import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { GoogleTagManagerHead, GoogleTagManagerBody } from '@/components/GoogleTagManager';
import { APP_NAME, APP_TAGLINE } from '@/lib/config';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_TAGLINE}`,
  // Belt-and-braces noindex (also enforced via headers + robots.ts). BRIEF §1, §7.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {GTM_ID && <GoogleTagManagerHead gtmId={GTM_ID} />}
      </head>
      <body>
        {GTM_ID && <GoogleTagManagerBody gtmId={GTM_ID} />}
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
