import { Suspense } from "react";
import type { Metadata } from "next";
import { Azeret_Mono, Barlow, Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow-condensed" });
const azeret = Azeret_Mono({ subsets: ["latin"], variable: "--font-azeret" });

export const metadata: Metadata = {
  title: "SecureLambda",
  description: "Pay per run to test a model on data you never see.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${barlow.variable} ${barlowCondensed.variable} ${azeret.variable} h-full antialiased`}
    >
      <body className="instrument flex min-h-full flex-col">
        <Providers>
          <Suspense fallback={<div className="h-[64px] border-b border-chassis-deep" />}>
            <AppHeader />
          </Suspense>
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
