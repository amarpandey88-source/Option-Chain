import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { UpdateButton } from "@/components/option-chain/update-button";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Option Chain Pulse — Real-time PCR, VIX & Smart Money Analyzer",
  description: "Real-time option chain analyzer with PCR, India VIX, smart money flow, GEX, multi-timeframe (5m/15m/30m) buy call/put signals, and trade recommendations.",
  keywords: ["option chain", "PCR", "India VIX", "smart money flow", "GEX", "max pain", "NIFTY", "BANKNIFTY", "options trading", "buy call put signal"],
  authors: [{ name: "Option Chain Pulse" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Option Chain Pulse",
    description: "Real-time option chain analyzer with multi-timeframe trade signals",
    siteName: "Option Chain Pulse",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Option Chain Pulse",
    description: "Real-time option chain analyzer with multi-timeframe trade signals",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#0a0e14] text-slate-100`}
      >
        <Providers><div className="relative min-h-screen">{children}<div className="fixed right-4 top-3 z-[100]"><UpdateButton /></div></div></Providers>
        <SonnerToaster position="top-right" theme="dark" toastOptions={{ style: { background: "#0f1620", border: "1px solid #1c2530", color: "#e2e8f0" } }} />
      </body>
    </html>
  );
}
