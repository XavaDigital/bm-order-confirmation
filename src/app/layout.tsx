import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { GoogleTagManagerHead, GoogleTagManagerBody } from '@/components/GoogleTagManager';
import { APP_TAGLINE } from '@/lib/config';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;

export const metadata: Metadata = {
  // Every page title renders as "OrderFlow - <page>" (David, 2026-08-04);
  // pages set just their name via metadata.title / generateMetadata.
  title: {
    template: 'OrderFlow - %s',
    default: `OrderFlow - ${APP_TAGLINE}`,
  },
  icons: { icon: '/beastmode-logo_favicon.png' },
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
        {/*
          Paint the page background before React hydrates. The theme lives in
          localStorage (client-only), so without this every route renders white
          first and then flips — worst on the standalone auth pages, which are a
          single card on a full-height background.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=localStorage.getItem('bm-admin-theme')==='dark';var e=document.documentElement;e.dataset.theme=d?'dark':'light';e.style.colorScheme=d?'dark':'light';e.style.background=d?'#191919':'#f8fafc';}catch(e){}})();`,
          }}
        />
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
