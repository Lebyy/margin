"use client";

import { MotionConfig } from "motion/react";
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
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ThemeProvider>
  );
}
