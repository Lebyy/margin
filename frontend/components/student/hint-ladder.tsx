"use client";

import { Tooltip } from "@heroui/react";
import { Lock } from "lucide-react";
import { motion } from "motion/react";
import { LEVEL_HELP, LEVEL_NAME, type HintLevel } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The hint ladder as one row: three rungs, the current one marked, locked past the ceiling.
 *
 * It sits in the workspace header so it is always in view and never in a
 * menu. A judge watches this move.
 *
 * `level` is the number in the last message response, or the session's stored
 * level after a reload. Nothing here can change it. A rung is not a button.
 * The server's policy is the only switch, and a rung that looked pressable
 * would promise an escalation the client cannot give.
 *
 * A rung above the ceiling is drawn locked, so a ceiling of 1 never shows
 * level 2 as reachable. The words that used to sit under each rung are in a
 * tooltip now. The row itself carries only the names.
 *
 * The red marker is one element that slides between rungs with a shared
 * layoutId, so the student sees it travel when a reply raises the level.
 */
export function HintLadder({ level, ceiling }: { level: HintLevel; ceiling: number }) {
  const rungs: HintLevel[] = [1, 2, 3];
  return (
    <ol className="flex items-center gap-1" aria-label={`Hint level ${level} of ${ceiling}`}>
      {rungs.map((rung) => {
        const current = rung === level;
        const locked = rung > ceiling;
        return (
          <li key={rung} aria-current={current ? "step" : undefined}>
            <Tooltip delay={200}>
              <Tooltip.Trigger>
                <span
                  className={cn(
                    "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm",
                    locked ? "text-muted opacity-50" : current ? "font-medium text-margin-red" : rung < level ? "text-foreground" : "text-muted",
                  )}
                >
                  {current ? (
                    <motion.span
                      layoutId="hint-ladder-current"
                      className="absolute inset-0 rounded-full border border-margin-red bg-margin-red-soft"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  ) : null}
                  <span className="relative tabular-nums">{locked ? <Lock className="size-3.5" aria-hidden /> : rung}</span>
                  <span className="relative">{LEVEL_NAME[rung]}</span>
                  {current ? <span className="sr-only"> (current)</span> : null}
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>{locked ? "Not offered on this assignment" : LEVEL_HELP[rung]}</Tooltip.Content>
            </Tooltip>
          </li>
        );
      })}
    </ol>
  );
}
