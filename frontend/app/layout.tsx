import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Margin",
  description: "The AI tutor your professor approves of.",
};

/**
 * The frame every screen shares: the header, then the page.
 *
 * `suppressHydrationWarning` is on <html> only. next-themes sets the theme
 * class there before React hydrates, so the server's markup and the browser's
 * differ on that one attribute by design. It is not set anywhere else, because
 * elsewhere a mismatch is a real bug to see.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
