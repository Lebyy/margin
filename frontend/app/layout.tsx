import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Margin",
  description: "The AI tutor your professor approves of.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
