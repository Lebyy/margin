"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AssignmentListItem } from "@/lib/api";
import { browser } from "@/lib/browser";

export type AssignmentPick =
  | { state: "loading" }
  | { state: "none" }
  | { state: "error"; message: string }
  | { state: "ready"; assignmentId: string; assignments: AssignmentListItem[]; choose: (id: string) => void };

/**
 * Which assignment a professor page is showing.
 *
 * The dashboard and the messages page both need one assignment id. It is the
 * one this browser last saved or chose, if the server still has it, and the
 * newest one otherwise. There is no course switcher behind this: it only
 * settles which of the saved assignments to read.
 *
 * `none` means no assignment exists at all. The page then tells the professor
 * to create one. It does not make one up to have something to draw.
 */
export function useAssignment(): AssignmentPick {
  const [pick, setPick] = useState<AssignmentPick>({ state: "loading" });

  useEffect(() => {
    let live = true;
    api
      .listAssignments()
      .then(({ assignments }) => {
        if (!live) return;
        if (assignments.length === 0) {
          setPick({ state: "none" });
          return;
        }
        const stored = browser.profAssignmentId();
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
              ? "The API is running without a database. Set MONGODB_URI in .env and restart."
              : "The API is not answering on localhost:4000. Start it with npm run dev.",
        });
      });
    return () => {
      live = false;
    };
  }, []);

  return pick;
}
