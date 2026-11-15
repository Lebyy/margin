"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AssignmentListItem } from "@/lib/api";
import { browser } from "@/lib/browser";

export type AssignmentPick =
  | { state: "loading" }
  | { state: "no_profile" }
  | { state: "none" }
  | { state: "error"; message: string }
  | { state: "ready"; assignmentId: string; assignments: AssignmentListItem[]; choose: (id: string) => void };

/**
 * Which assignment a professor page is showing.
 *
 * The dashboard and the messages page both need one assignment id. It is the
 * one named by `?assignment=` in the URL (a class page links here that way),
 * else the one this browser last saved or chose, if the server still has it,
 * and the newest one otherwise. There is no course switcher behind this: it only
 * settles which of the saved assignments to read.
 *
 * Only the chosen professor's classes are offered (GET /api/prof/assignments
 * is scoped by the professor header). With no professor chosen the state is
 * `no_profile` and nothing is read, so a page never shows another
 * professor's class by default.
 *
 * `none` means no assignment exists at all. The page then tells the professor
 * to create one. It does not make one up to have something to draw.
 */
export function useAssignment(): AssignmentPick {
  const [pick, setPick] = useState<AssignmentPick>({ state: "loading" });

  useEffect(() => {
    let live = true;
    if (!browser.profProfile()) {
      const id = window.setTimeout(() => live && setPick({ state: "no_profile" }), 0);
      return () => {
        live = false;
        window.clearTimeout(id);
      };
    }
    api
      .profAssignments()
      .then(({ assignments }) => {
        if (!live) return;
        if (assignments.length === 0) {
          setPick({ state: "none" });
          return;
        }
        // A link from a class page names the assignment with ?assignment=; it wins over what this browser last chose, and becomes the new choice.
        const asked = new URLSearchParams(window.location.search).get("assignment");
        const stored = asked && assignments.some((a) => a.id === asked) ? asked : browser.profAssignmentId();
        if (asked && stored === asked) browser.setProfAssignmentId(asked);
        const initial = assignments.some((a) => a.id === stored) ? (stored as string) : assignments[0].id;
        const choose = (id: string) => {
          browser.setProfAssignmentId(id);
          setPick({ state: "ready", assignmentId: id, assignments, choose });
        };
        setPick({ state: "ready", assignmentId: initial, assignments, choose });
      })
      .catch((e: unknown) => {
        if (!live) return;
        setPick({
          state: "error",
          message:
            e instanceof ApiError && e.code === "database_unavailable"
              ? "The database is not connected."
              : "Askretes is not reachable.",
        });
      });
    return () => {
      live = false;
    };
  }, []);

  return pick;
}
