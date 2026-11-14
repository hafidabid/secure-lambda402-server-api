import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { AppHeader } from "@/components/AppHeader";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SecureLambda",
  description: "Pay per run to test a model on data you never see.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>
          <Suspense fallback={<div className="h-[61px] border-b border-line bg-surface" />}>
            <AppHeader />
          </Suspense>
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
