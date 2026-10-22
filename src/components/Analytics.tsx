import Script from "next/script";
import { ADS_CONVERSION_ID, GA_MEASUREMENT_ID } from "@/lib/site";

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
