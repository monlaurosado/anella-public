import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getAppUrl, isStagingDeployment } from "@/config/env";
import { contentSecurityPolicyForMeta } from "@/lib/content-security-policy";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  applicationName: "Anella",
  title: {
    default: "Anella",
    template: "%s · Anella",
  },
  description:
    "Plataforma web para coordinar ayuda ciudadana verificada durante emergencias.",
  manifest: "/manifest.webmanifest",
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  robots: isStagingDeployment()
    ? { index: false, follow: false, nocache: true }
    : undefined,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A nonce-based CSP is generated per request in proxy.ts. Next can only
  // propagate that nonce to framework scripts when the route is rendered
  // dynamically, so the root layout deliberately opts every page into a
  // request-time render.
  await connection();
  const responsePolicy = (await headers()).get("content-security-policy");
  const metaPolicy = responsePolicy
    ? contentSecurityPolicyForMeta(responsePolicy)
    : null;

  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {metaPolicy ? (
        <meta
          httpEquiv="Content-Security-Policy"
          content={metaPolicy}
          data-anella-csp-fallback="true"
        />
      ) : null}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
