import type { Metadata } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import "./globals.css";

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SafeRoute KW",
  description:
    "8,928 real Kitchener collisions mapped, analyzed, and explained.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmMono.variable} ${dmSans.variable}`}
      style={{ backgroundColor: "#0A0C0F" }}
    >
      <body
        className="font-sans antialiased"
        style={{ backgroundColor: "#0A0C0F", color: "#F0F2F5" }}
      >
        {children}
      </body>
    </html>
  );
}
