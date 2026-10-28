import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Todo demo · BusinessMode",
  description: "Try access codes in a small Next.js app powered by BusinessMode.",
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
