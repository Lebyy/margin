"use client";

import { Card, Chip } from "@heroui/react";
import { Lock } from "lucide-react";
import { motion } from "motion/react";
import { LEVEL_HELP, LEVEL_NAME, type HintLevel } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The hint ladder: three rungs, the current one marked, and the professor's ceiling.
 *
 * It is always on screen and never inside a menu, because a judge has two
 * minutes and the level moving is the thing to watch.
 *
 * `level` is the number in the last message response, or the session's stored
 * level after a reload. This component has no way to change it. There is no
 * click handler on a rung and no "next hint" button. The server's policy is
 * the only switch. A rung that looked pressable would promise an escalation
 * the client cannot give.
 *
 * A rung above the ceiling is drawn locked and described as not offered on
 * this assignment, so a ceiling of 1 never shows level 2 as something the
 * student could reach.
 *
 * The red marker is one element that moves between rungs with a shared
 * layoutId. The student sees it travel to the new rung when a reply raises
 * the level.
 */
export function HintLadder({ level, ceiling }: { level: HintLevel; ceiling: number }) {
  const rungs: HintLevel[] = [1, 2, 3];
  return (
    <Card aria-label="Hint level">
      <Card.Header>
        <div className="flex items-center justify-between gap-2">
          <Card.Title>Hint level</Card.Title>
          <Chip size="sm" variant="soft">
            ceiling {ceiling} of 3
          </Chip>
        </div>
        <Card.Description>Set by the server after each message. A further hint needs a new try.</Card.Description>
      </Card.Header>
      <Card.Content>
        <ol className="flex flex-col gap-1.5" aria-label={`Current level ${level}, ceiling ${ceiling}`}>
          {rungs.map((rung) => {
            const current = rung === level;
            const locked = rung > ceiling;
            const passed = rung < level;
            return (
              <li
                key={rung}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "relative flex items-start gap-3 rounded-lg px-3 py-2.5",
                  locked && "opacity-55",
                )}
              >
                {current ? (
                  <motion.span
                    layoutId="hint-ladder-current"
                    className="absolute inset-0 rounded-lg border border-margin-red bg-margin-red-soft"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <span
                  className={cn(
                    "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    current
                      ? "border-margin-red bg-margin-red text-background"
                      : passed
                        ? "border-border bg-default text-foreground"
                        : "border-border text-muted",
                  )}
                >
                  {locked ? <Lock className="size-3" aria-hidden /> : rung}
                </span>
                <span className="relative min-w-0">
                  <span className="block text-sm font-medium">
                    {LEVEL_NAME[rung]}
                    {current ? <span className="sr-only"> (current level)</span> : null}
                  </span>
                  <span className="block text-xs text-muted">
                    {locked ? "Not offered on this assignment." : LEVEL_HELP[rung]}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
          There is no level 4. Margin never writes the solution, a line of it, or the final answer.
        </p>
      </Card.Content>
    </Card>
  );
}
