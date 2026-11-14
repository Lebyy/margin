"use client";

import { Chip } from "@heroui/react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

/**
 * The header on every screen: the name, which side you are on, and the sign-in side.
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
        <NextLink href="/" className="flex shrink-0 items-center gap-2 rounded-md outline-offset-4" aria-label="Margin, home">
          <span aria-hidden className="h-6 w-[3px] rounded-full bg-margin-red" />
          <span className="font-serif text-xl font-semibold tracking-tight">Margin</span>
        </NextLink>
        {side ? (
          // On a phone the four professor links need the room, so the side label is shown from sm up.
          <Chip size="sm" variant="soft" color={side === "prof" ? "accent" : "default"} className="hidden sm:inline-flex">
            signed in as {side}
          </Chip>
        ) : null}
        {/* At phone width the links scroll sideways inside the bar rather than pushing the page wider. */}
        <nav className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Main">
          {side === "prof" ? (
            <>
              <NavLink href="/prof/courses" current={pathname}>Classes</NavLink>
              <NavLink href="/prof/setup" current={pathname}>New</NavLink>
              <NavLink href="/prof/dashboard" current={pathname}>Dashboard</NavLink>
              <NavLink href="/prof/messages" current={pathname}>Messages</NavLink>
            </>
          ) : null}
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
