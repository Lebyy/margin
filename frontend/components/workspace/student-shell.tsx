"use client";

import { Button, Drawer, Tooltip } from "@heroui/react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ClassSidebar, type SidebarData } from "@/components/workspace/class-sidebar";
import { api, ApiError, type Course } from "@/lib/api";
import { browser } from "@/lib/browser";
import { useMedia } from "@/lib/use-media";
import { AskretesMark } from "@/components/brand/askretes-mark";

/**
 * What a page inside the workspace can ask of the frame around it.
 *
 * `refresh` re-reads the sidebar after something a page did changes it:
 * joining a class adds it, and starting or submitting an assignment changes
 * the status mark beside it. The sidebar has no other way to hear about
 * those, because each is a request the page made, not one the sidebar made.
 *
 * `openNav` opens the class list below `lg`, where it is a drawer and the
 * page's own header holds the button for it.
 */
type Workspace = { refresh: () => void; openNav: () => void };

const WorkspaceContext = createContext<Workspace>({ refresh: () => undefined, openNav: () => undefined });

/** The same context for the professor's shell (components/workspace/prof-shell.tsx), so NavButton and useWorkspace work on both sides. */
export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): Workspace {
  return useContext(WorkspaceContext);
}

/** Where this browser remembers that the sidebar was folded to a rail. A per-viewer convenience: losing it only unfolds the sidebar. */
const FOLDED_KEY = "margin.sidebar.folded";

/**
 * The student workspace: classes down the left, the page beside them.
 *
 * It is the shape of a chat app on purpose. A class is a folder of
 * conversations and each assignment in it is one conversation, because the
 * server keeps one tutoring session per assignment: the hint level, the
 * question the student is on, and the turns all belong to that session. A
 * class-wide conversation would have no hint level to keep, so a class opens
 * to its overview and the conversations start from its assignments.
 *
 * The sidebar lists only what exists. Classes come from the server's class
 * list and this student's enrollments, and assignments from each class. A
 * browser with no student sees every class as one to join, and nothing is
 * listed as theirs.
 *
 * The frame takes the full height of the window and does not scroll. Each
 * page scrolls its own column, so the chat's box stays at the bottom while
 * the thread above it moves.
 */
export function StudentShell({ children }: { children: ReactNode }) {
  const wide = useMedia("(min-width: 1024px)");
  const pathname = usePathname();
  const [data, setData] = useState<SidebarData | null>(null);
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

  // The drawer closes when a link in it is followed, so the page the student chose is what they see.
  useEffect(() => {
    const id = window.setTimeout(() => setNavOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  useEffect(() => {
    let live = true;
    const studentId = browser.studentId();
    (async () => {
      try {
        const [all, mine] = await Promise.all([
          api.courses(),
          // A stored id this database no longer knows reads as "no student yet", not as an error.
          studentId ? api.myCourses(studentId).catch(() => null) : Promise.resolve(null),
        ]);
        // Each joined class is read in full for its assignments and this student's status on each. A class that fails to load is still listed, with no assignments under it.
        const courses: Course[] = (
          await Promise.all((mine?.courses ?? []).map((c) => api.course(c.id, studentId).catch(() => null)))
        ).filter((c): c is Course => c !== null);
        if (!live) return;
        const joined = new Set(courses.map((c) => c.id));
        setData({
          profile: browser.studentProfile(),
          mine: courses,
          dueThisWeek: Object.fromEntries((mine?.courses ?? []).map((c) => [c.id, c.due_this_week])),
          others: all.courses.filter((c) => !joined.has(c.id)),
          problem: null,
        });
      } catch (e) {
        if (!live) return;
        setData({ profile: null, mine: [], dueThisWeek: {}, others: [], problem: e instanceof ApiError && e.code === "database_unavailable" ? "The database is not connected." : "Askretes is not reachable." });
      }
    })();
    return () => {
      live = false;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const openNav = useCallback(() => setNavOpen(true), []);

  function fold(next: boolean) {
    setFolded(next);
    try {
      window.localStorage.setItem(FOLDED_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the sidebar stays as chosen for this visit.
    }
  }

  return (
    <WorkspaceContext.Provider value={{ refresh, openNav }}>
      <div className="flex h-dvh overflow-hidden bg-background">
        {wide ? (
          folded ? (
            <FoldedRail data={data} onUnfold={() => fold(false)} />
          ) : (
            <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-background" aria-label="Classes">
              <ClassSidebar data={data} pathname={pathname} action={<FoldButton onPress={() => fold(true)} />} />
            </aside>
          )
        ) : (
          <Drawer>
            <Drawer.Backdrop isOpen={navOpen} onOpenChange={setNavOpen} variant="blur">
              <Drawer.Content placement="left">
                <Drawer.Dialog className="flex w-[min(20rem,88vw)] flex-col p-0" aria-label="Classes">
                  <ClassSidebar data={data} pathname={pathname} action={<Drawer.CloseTrigger className="static" />} />
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer>
        )}
        {/* The page sits on the warm paper colour, solid, so the glows behind the professor pages do not tint the chat. */}
        <div className="flex min-w-0 flex-1 flex-col bg-paper">{children}</div>
      </div>
    </WorkspaceContext.Provider>
  );
}

/** Folds the sidebar to a rail, so the chat and the work get the width. */
function FoldButton({ onPress }: { onPress: () => void }) {
  return (
    <Tooltip delay={300}>
      <Button isIconOnly size="sm" variant="ghost" aria-label="Fold the class list" onPress={onPress}>
        <PanelLeftClose className="size-4" />
      </Button>
      <Tooltip.Content>Fold</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * The sidebar folded to a rail: the margin mark, the unfold button, and one
 * button per class with its code. A class keeps its link here, so a folded
 * sidebar is narrower and not a step further away.
 */
function FoldedRail({ data, onUnfold }: { data: SidebarData | null; onUnfold: () => void }) {
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-background py-3" aria-label="Classes">
      <NextLink href="/" aria-label="Askretes, home" className="mb-1 flex h-8 items-center rounded-md outline-offset-4">
        <AskretesMark className="size-6" />
      </NextLink>
      <Tooltip delay={300}>
        <Button isIconOnly size="sm" variant="ghost" aria-label="Unfold the class list" onPress={onUnfold}>
          <PanelLeftOpen className="size-4" />
        </Button>
        <Tooltip.Content placement="right">Unfold</Tooltip.Content>
      </Tooltip>
      <ul className="mt-2 flex flex-col items-center gap-1.5">
        {(data?.mine ?? []).map((c) => (
          <li key={c.id}>
            <Tooltip delay={200}>
              <Tooltip.Trigger>
                <NextLink
                  href={`/course/${c.id}`}
                  className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-[0.65rem] font-semibold uppercase tracking-tight hover:bg-default"
                  aria-label={c.name}
                >
                  {(c.code || c.name).replace(/[^A-Za-z0-9]/g, "").slice(0, 4)}
                </NextLink>
              </Tooltip.Trigger>
              <Tooltip.Content placement="right">{c.name}</Tooltip.Content>
            </Tooltip>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The button that opens the class list below `lg`. Pages put it at the start
 * of their header; on a wide screen the sidebar is always there and this
 * draws nothing.
 */
export function NavButton() {
  const { openNav } = useWorkspace();
  return (
    <Button isIconOnly size="sm" variant="ghost" aria-label="Open the class list" className="lg:hidden" onPress={openNav}>
      <Menu className="size-4" />
    </Button>
  );
}
