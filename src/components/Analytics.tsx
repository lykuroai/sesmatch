import Script from "next/script";
import { ADS_CONVERSION_ID, GA_MEASUREMENT_ID, GTM_CONTAINER_ID } from "@/lib/site";

// GA4 計測タグ + Google 広告コンバージョン用の Google タグ設定。測定ID未設定なら何も出力しない
export function Analytics() {
  if (!GA_MEASUREMENT_ID) return null;
  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');${ADS_CONVERSION_ID ? `\ngtag('config', '${ADS_CONVERSION_ID}');` : ""}`}
      </Script>
    </>
  );
}

// Google タグマネージャー（コンテナスニペット）。beforeInteractive により Next.js が <head> の先頭付近に出力する。
// ルートレイアウトに置くこと。コンテナID未設定なら何も出力しない
export function GoogleTagManager() {
  if (!GTM_CONTAINER_ID) return null;
  return (
    <Script id="gtm" strategy="beforeInteractive">
      {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`}
    </Script>
  );
}

// Google タグマネージャーの noscript フォールバック（<body> 直後に置く）
export function GoogleTagManagerNoScript() {
  if (!GTM_CONTAINER_ID) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  );
}
