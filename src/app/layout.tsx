import type { Metadata } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { GoogleTagManagerHead, GoogleTagManagerBody } from '@/components/GoogleTagManager';
import { Providers } from './providers';
import './globals.css';

const bebas = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

export const metadata: Metadata = {
  title: 'BeastMode — Order Confirmation',
  // Belt-and-braces noindex (also enforced via headers + robots.ts). BRIEF §1, §7.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${bebas.variable} ${inter.variable}`} suppressHydrationWarning>
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
