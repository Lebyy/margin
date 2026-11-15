import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Askretes",
  description: "The AI tutor your professor approves of.",
};

/**
 * The document every screen shares. It holds the providers and nothing else.
 *
 * The two sides frame themselves. The professor side (`app/prof/layout.tsx`)
 * is a header over a centred page. The student side (`app/(student)/layout.tsx`)
 * is a full-height workspace with the classes down the left, the chat in the
 * middle, and the work beside it. A header here would sit above that
 * workspace and take height the chat needs.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
