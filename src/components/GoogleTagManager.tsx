interface Props {
  gtmId: string;
}

/**
 * GTM loader script — rendered as a plain <script> in <head> so Tag Assistant
 * and the browser detect it in the initial HTML, not after JS hydration.
 * next/script with afterInteractive races with Tag Assistant's detection.
 */
export function GoogleTagManagerHead({ gtmId }: Props) {
  return (
    // eslint-disable-next-line react/no-danger
    <script
      id="gtm-head"
      dangerouslySetInnerHTML={{
        __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`,
      }}
    />
  );
}

/** noscript fallback — place right after the opening <body> tag. */
export function GoogleTagManagerBody({ gtmId }: Props) {
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
        title="GTM"
      />
    </noscript>
  );
}
