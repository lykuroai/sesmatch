import Script from "next/script";
import { GTM_CONTAINER_ID } from "@/lib/site";

// Google タグマネージャー（コンテナスニペット）。beforeInteractive により Next.js が <head> に出力する。
// GA4・Google 広告のタグは GTM コンテナ側で設定する（gtag.js の直接読込は 2026-10-22 に廃止）。
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
