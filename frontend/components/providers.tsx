"use client";

import { RouterProvider } from "@heroui/react/rac";
import { MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * The two app-wide client providers.
 *
 * next-themes writes both `class` and `data-theme` on <html>. HeroUI's tokens
 * switch on either one, and the `dark:` variant in globals.css reads the same
 * two, so one toggle moves every color on the page. The first paint follows
 * the system setting. After the toggle is used, the choice is kept in
 * localStorage and wins.
 *
 * MotionConfig with `reducedMotion="user"` makes every motion component honor
 * the system's reduced-motion setting. Removing it would leave the chat
 * messages sliding for a person who asked the system not to.
 *
 * RouterProvider hands HeroUI's links (breadcrumbs, link buttons) to the Next
 * router, so following one is a client-side navigation like a NextLink and
 * does not reload the page and drop the chat.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="system" enableSystem disableTransitionOnChange>
      <RouterProvider navigate={(href) => router.push(href)}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </RouterProvider>
    </ThemeProvider>
  );
}
