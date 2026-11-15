"use client";

import { Button, Drawer, ScrollShadow, Spinner, Tooltip } from "@heroui/react";
import { ChartColumn, ChevronRight, House, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import NextLink from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { ProfileMenu } from "@/components/profile-menu";
import { NavButton, WorkspaceProvider } from "@/components/workspace/student-shell";
import { api, type Course, type ProfCourseCard } from "@/lib/api";
import { browser } from "@/lib/browser";
import { ACCENT_BG } from "@/lib/courses";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { AskretesMark, AskretesWordmark } from "@/components/brand/askretes-mark";

/** Where this browser remembers that the professor's sidebar was folded. A per-viewer convenience. */
const FOLDED_KEY = "margin.prof.sidebar.folded";

type ProfData = { profile: string | null; classes: (ProfCourseCard & { items: Course["items"] })[]; problem: string | null };

/**
 * The professor's workspace: the same shape as the student's. Classes down
 * the left, each opening to its assignments; an assignment opens as a
 * conversation with Askretes about the class, with the dashboard beside it.
 *
 * Only the chosen professor's classes are listed (the class list is scoped by
 * the professor header, and filtered to their name). The other professor
 * pages (all classes, one class, a new assignment) scroll in the middle; the
 * assignment workspace fills it and manages its own columns.
 */
export function ProfShell({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const wide = useMedia("(min-width: 1024px)");
  const pathname = usePathname();
  const params = useSearchParams();
  const openAssignment = pathname === "/prof/dashboard" ? params.get("assignment") : null;
  const [data, setData] = useState<ProfData | null>(null);
  const [folded, setFolded] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FOLDED_KEY) === "1";
      const id = window.setTimeout(() => setFolded(stored), 0);
      return () => window.clearTimeout(id);
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setNavOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname, openAssignment]);

  useEffect(() => {
    let live = true;
    const profile = browser.profProfile();
    (async () => {
      try {
        const { courses } = await api.profCourses();
        const mine = courses.filter((c) => !profile || c.professor === profile);
        const full = await Promise.all(mine.map(async (c) => ({ ...c, items: (await api.course(c.id).catch(() => null))?.items ?? [] })));
        if (live) setData({ profile, classes: full, problem: null });
      } catch {
        if (live) setData({ profile, classes: [], problem: "Askretes is not reachable." });
      }
    })();
    return () => {
      live = false;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const openNav = useCallback(() => setNavOpen(true), []);
  const fold = (next: boolean) => {
    setFolded(next);
    try {
      window.localStorage.setItem(FOLDED_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the sidebar stays as chosen for this visit.
    }
  };

  const sidebar = (action: ReactNode) => <ProfSidebar data={data} pathname={pathname} openAssignment={openAssignment} action={action} />;
  // The workspaces (an assignment, a class) manage their own columns and scrolling; every other professor page scrolls in the middle under a slim bar.
  const fills = pathname === "/prof/dashboard" || /^\/prof\/courses\/[^/]+$/.test(pathname);

  return (
    <WorkspaceProvider value={{ refresh, openNav }}>
      <div className="flex h-dvh overflow-hidden bg-background">
        {wide ? (
          folded ? (
            <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-background py-3" aria-label="Classes">
              <NextLink href="/prof/courses" aria-label="Askretes, your classes" className="mb-1 flex h-8 items-center">
                <AskretesMark className="size-6" />
              </NextLink>
              <Button isIconOnly size="sm" variant="ghost" aria-label="Unfold the class list" onPress={() => fold(false)}>
                <PanelLeftOpen className="size-4" />
              </Button>
            </nav>
          ) : (
            <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-background" aria-label="Classes">
              {sidebar(
                <Tooltip delay={300}>
                  <Button isIconOnly size="sm" variant="ghost" aria-label="Fold the class list" onPress={() => fold(true)}>
                    <PanelLeftClose className="size-4" />
                  </Button>
                  <Tooltip.Content>Fold</Tooltip.Content>
                </Tooltip>,
              )}
            </aside>
          )
        ) : (
          <Drawer>
            <Drawer.Backdrop isOpen={navOpen} onOpenChange={setNavOpen} variant="blur">
              <Drawer.Content placement="left">
                <Drawer.Dialog className="flex w-[min(20rem,88vw)] flex-col p-0" aria-label="Classes">
                  {sidebar(<Drawer.CloseTrigger className="static" />)}
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer>
        )}
        <div className="flex min-w-0 flex-1 flex-col bg-paper">
          {fills ? (
            children
          ) : (
            <>
              <div className="flex h-12 shrink-0 items-center px-3 lg:hidden">
                <NavButton />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-8 sm:pt-10">{children}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </WorkspaceProvider>
  );
}

/**
 * The professor's class list. Each class is a link to the class with a
 * button that opens its assignments beneath it; each assignment opens its
 * workspace (Askretes and the dashboard). The class holding the open
 * assignment opens on its own.
 */
function ProfSidebar({ data, pathname, openAssignment, action }: { data: ProfData | null; pathname: string; openAssignment: string | null; action: ReactNode }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const current = data?.classes.find((c) => pathname === `/prof/courses/${c.id}` || c.items.some((a) => a.id === openAssignment))?.id ?? null;
  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setOpen((prev) => (prev.has(current) ? prev : new Set(prev).add(current))), 0);
    return () => window.clearTimeout(id);
  }, [current]);

  const row = (active: boolean) =>
    cn("flex min-h-8 items-center gap-2 rounded-lg px-3 py-1 text-sm outline-offset-[-2px] transition-colors", active ? "bg-default font-medium text-foreground" : "text-foreground/90 hover:bg-default/70");

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <NextLink href="/prof/courses" className="flex items-center gap-2 rounded-md outline-offset-4" aria-label="Askretes, your classes">
          <AskretesWordmark className="text-[1.375rem]" />
        </NextLink>
        <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">Teaching</span>
        <span className="ml-auto" />
        {action}
      </div>
      <ScrollShadow className="min-h-0 flex-1 px-2 pb-4" hideScrollBar>
        <nav aria-label="Your classes" className="flex flex-col gap-5">
          <div className="flex flex-col gap-0.5">
            <NextLink href="/prof/courses" aria-current={pathname === "/prof/courses" ? "page" : undefined} className={row(pathname === "/prof/courses")}>
              <House className="size-4 shrink-0 text-muted" aria-hidden /> All classes
            </NextLink>
            <NextLink href="/prof/setup" aria-current={pathname === "/prof/setup" ? "page" : undefined} className={row(pathname === "/prof/setup")}>
              <Plus className="size-4 shrink-0 text-muted" aria-hidden /> New assignment
            </NextLink>
          </div>
          {data === null ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" aria-label="Loading your classes" />
            </div>
          ) : data.problem ? (
            <p className="px-3 text-sm text-muted">{data.problem}</p>
          ) : (
            <section aria-labelledby="prof-sidebar-classes">
              <h2 id="prof-sidebar-classes" className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Classes
              </h2>
              {data.classes.length === 0 ? (
                <p className="px-3 text-sm text-muted">{data.profile ? "No classes yet." : "Choose who you are below."}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {data.classes.map((c) => {
                    const isOpen = open.has(c.id);
                    const href = `/prof/courses/${c.id}`;
                    return (
                      <li key={c.id}>
                        <div className="flex items-center gap-0.5">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={`${isOpen ? "Hide" : "Show"} assignments in ${c.name}`}
                            aria-expanded={isOpen}
                            onPress={() =>
                              setOpen((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.id)) next.delete(c.id);
                                else next.add(c.id);
                                return next;
                              })
                            }
                          >
                            <ChevronRight className={cn("size-3.5 text-muted transition-transform", isOpen && "rotate-90")} />
                          </Button>
                          <NextLink href={href} aria-current={pathname === href ? "page" : undefined} className={cn(row(pathname === href), "min-w-0 flex-1 pl-1.5")} title={c.name}>
                            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", ACCENT_BG[c.accent])} />
                            <span className="min-w-0 flex-1 truncate">
                              {c.code ? <span className="font-medium">{c.code}</span> : <span className="font-medium">{c.name}</span>}
                              {c.code ? <span className="ml-1.5 text-muted">{c.name.replace(c.code, "").replace(/^[\s:–-]+/, "") || c.name}</span> : null}
                            </span>
                          </NextLink>
                        </div>
                        {isOpen ? (
                          <ul className="mb-1 ml-[1.15rem] flex flex-col gap-0.5 border-l border-border pl-2">
                            {c.items.length === 0 ? (
                              <li className="px-3 py-1.5 text-sm text-muted">No assignments yet</li>
                            ) : (
                              c.items.map((a) => (
                                <li key={a.id}>
                                  <NextLink
                                    href={`/prof/dashboard?assignment=${a.id}`}
                                    aria-current={openAssignment === a.id ? "page" : undefined}
                                    className={cn(row(openAssignment === a.id), "py-1.5")}
                                  >
                                    <ChartColumn className="size-3.5 shrink-0 text-muted" aria-hidden />
                                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                                    {a.margin_enabled === false ? <span className="text-xs text-muted">off</span> : null}
                                  </NextLink>
                                </li>
                              ))
                            )}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </nav>
      </ScrollShadow>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2.5">
        <ProfileMenu side="prof" placement="top start" />
        <NextLink href="/" className="ml-auto shrink-0 rounded-md px-2 py-1 text-sm text-muted underline-offset-4 hover:text-foreground hover:underline">
          I study
        </NextLink>
      </div>
    </>
  );
}
