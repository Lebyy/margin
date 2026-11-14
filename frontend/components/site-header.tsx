"use client";

import { Button, Chip, Tooltip } from "@heroui/react";
import { Moon, Sun } from "lucide-react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { ThemeToggler } from "@/components/animate-ui/primitives/effects/theme-toggler";

/**
 * The header on every screen: the name, which side you are on, and the theme toggle.
 *
 * The side is read from the path. There is no account behind it. The two
 * hard-coded sign-ins are the words `student` and `prof`, and the chip shows
 * which one this page is. The debug drawer is not reachable from here, because
 * it belongs to the student page and must not appear on the professor's.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const side = pathname.startsWith("/prof") ? "prof" : pathname.startsWith("/student") ? "student" : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <NextLink href="/" className="flex items-center gap-2 rounded-md outline-offset-4" aria-label="Margin, home">
          <span aria-hidden className="h-6 w-[3px] rounded-full bg-margin-red" />
          <span className="font-serif text-xl font-semibold tracking-tight">Margin</span>
        </NextLink>
        {side ? (
          <Chip size="sm" variant="soft" color={side === "prof" ? "accent" : "default"}>
            signed in as {side}
          </Chip>
        ) : null}
        <nav className="ml-auto flex items-center gap-1" aria-label="Main">
          {side === "prof" ? (
            <>
              <NavLink href="/prof/courses" current={pathname}>Classes</NavLink>
              <NavLink href="/prof/setup" current={pathname}>New</NavLink>
              <NavLink href="/prof/dashboard" current={pathname}>Dashboard</NavLink>
              <NavLink href="/prof/messages" current={pathname}>Messages</NavLink>
            </>
          ) : null}
          <ThemeButton />
        </nav>
      </div>
    </header>
  );
}

/** One header link. `aria-current` marks the page you are on, so a screen reader hears it and the style does not carry that alone. */
function NavLink({ href, current, children }: { href: string; current: string; children: React.ReactNode }) {
  const active = current === href;
  return (
    <NextLink
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1.5 text-sm transition-colors hover:bg-default ${active ? "font-medium text-foreground" : "text-muted"}`}
    >
      {children}
    </NextLink>
  );
}

/**
 * The dark and light switch.
 *
 * Animate UI's ThemeToggler wipes the new theme across the page with a view
 * transition, and the button itself is HeroUI's. Until the page has mounted
 * the resolved theme is unknown on the server, so the button renders in a
 * fixed state first. Rendering the sun or moon from the server's guess would
 * flash the wrong icon for anyone whose system is dark.
 */
function ThemeButton() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  // False while rendering on the server and during hydration, true after. There is nothing to subscribe to, so the subscribe function is empty.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const resolved = mounted && resolvedTheme === "dark" ? "dark" : "light";
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <ThemeToggler
      theme={(theme as "light" | "dark" | "system") ?? "system"}
      resolvedTheme={resolved}
      setTheme={setTheme}
      direction="ttb"
    >
      {({ toggleTheme }) => (
        <Tooltip delay={400}>
          <Button isIconOnly size="sm" variant="ghost" aria-label={`Switch to ${next} theme`} onPress={() => toggleTheme(next)}>
            {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Tooltip.Content>Switch to {next}</Tooltip.Content>
        </Tooltip>
      )}
    </ThemeToggler>
  );
}
