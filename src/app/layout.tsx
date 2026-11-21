import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../style.css";

export const metadata: Metadata = {
  title: "香港智慧城市地圖",
  description: "在香港地圖上看港鐵到站班次和運輸署交通快拍。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <noscript>這幅地圖需要 JavaScript 才能顯示港鐵班次和交通快拍。</noscript>
      </body>
    </html>
  );
}
