"use client";

import Script from "next/script";
export default function CesiumBaseUrl() {
  return (
    <Script id="cesium-base-url" strategy="beforeInteractive">
      {`window.CESIUM_BASE_URL = "/cesium";`}
    </Script>
  );
}
