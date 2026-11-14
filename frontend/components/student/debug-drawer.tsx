"use client";

import { Button, Chip, Drawer, Kbd } from "@heroui/react";
import { Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { LEVEL_NAME, type HintLevel, type TurnReply } from "@/lib/api";
import { cn } from "@/lib/utils";

/** One finished turn as the drawer needs it: what was asked, the level before it, and the server's whole reply. */
export type DebugTurn = {
  id: string;
  asked: string;
  levelBefore: HintLevel;
  result: TurnReply;
};

/**
 * The demo-only debug drawer. A keyboard shortcut on the student page opens it.
 *
 * It shows, per turn, the five steps the server ran: scribe, policy, tutor,
 * guard, and what the student saw. This is how a judge sees the jailbreak get
 * caught: the scribe row says the message was a request for the answer, the
 * policy row says the level was held, and the guard row says what happened to
 * the draft.
 *
 * Everything here comes from the message response. The drawer does not fetch
 * anything, and it cannot show the answer key, because the response does not
 * contain it. The guard's reason is printed only when the response says the
 * canary check is clean and the draft was released. That word is "absent".
 * A fallback turn prints "The draft was held." and does not print the reason,
 * because the held draft is not a field on this turn and must not appear here.
 * The marker itself is not in this file and is not rendered.
 *
 * It is closed by default and is only mounted on the student page. The
 * professor's screens never render it. The scripted jailbreak lives on this
 * drawer, so a student doing the assignment does not press it by mistake. It
 * still goes out as an ordinary message.
 */
export function DebugDrawer({
  isOpen,
  onOpenChange,
  turns,
  ceiling,
  onDemo,
  demoBusy,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  turns: DebugTurn[];
  ceiling: number;
  /** Sends the scripted jailbreak through the same turn as any other message. Absent until a session exists, so it cannot fire on the name step. */
  onDemo?: () => void;
  demoBusy?: boolean;
}) {
  return (
    <Drawer>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="blur">
        <Drawer.Content placement="right">
          <Drawer.Dialog className="w-full sm:max-w-md" aria-label="Debug drawer">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <Drawer.Heading>What the server did</Drawer.Heading>
              <p className="text-xs text-muted">
                Demo only. Toggle with <Kbd>Ctrl</Kbd> <Kbd>.</Kbd> The student never sees this.
              </p>
              {onDemo ? (
                <Button size="sm" variant="secondary" className="mt-3" isDisabled={demoBusy} isPending={demoBusy} onPress={onDemo}>
                  Ask for the answer
                </Button>
              ) : null}
            </Drawer.Header>
            <Drawer.Body>
              {turns.length === 0 ? (
                <p className="text-sm text-muted">No turns yet. Send a message and its steps appear here.</p>
              ) : (
                <ol className="flex flex-col gap-5">
                  {[...turns].reverse().map((turn, i) => (
                    <TurnTrace key={turn.id} turn={turn} ceiling={ceiling} number={turns.length - i} />
                  ))}
                </ol>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}

/**
 * The five steps of one turn, in the order the server ran them.
 *
 * `caught` is true when the guard refused at least one draft: a retry
 * happened, or the reply is the fallback sentence. That row turns red and
 * pulses once. A turn where the tutor simply declined and the guard had
 * nothing to hold is not marked as a catch, because nothing leaked there to
 * catch. The scribe row is what shows that turn was recognized.
 */
function TurnTrace({ turn, ceiling, number }: { turn: DebugTurn; ceiling: number; number: number }) {
  const { result, levelBefore } = turn;
  const { verdict, retries, label, level } = result;
  const fellBack = verdict.layer === "fallback";
  const caught = fellBack || retries > 0;
  // The chip and the reason agree with the server. "absent" is the only value
  // that may be shown. Any other value, including a leaked marker, is not rendered.
  const canaryAbsent = result.canary === "absent";

  const policy =
    level > levelBefore
      ? `Raised ${levelBefore} to ${level}: a new try, and not a request for the answer.`
      : level < levelBefore
        ? `Lowered ${levelBefore} to ${level}: the guard held a draft and asked for a lower rung.`
        : label.answer_request
          ? `Held at ${level}: a request for the answer never raises the level.`
          : !label.attempt_made
            ? `Held at ${level}: no new try since the last hint.`
            : level >= ceiling
              ? `Held at ${level}: this is the professor's ceiling.`
              : `Held at ${level}.`;

  return (
    <li>
      <div className="mb-2 flex items-center gap-2">
        <Chip size="sm" variant="soft">turn {number}</Chip>
        {label.answer_request ? (
          <Chip size="sm" variant="primary" color="danger">
            caught · {fellBack ? "The draft was held." : level > levelBefore ? "check the policy" : "level held"}
          </Chip>
        ) : fellBack ? (
          <Chip size="sm" variant="primary" color="danger">The draft was held.</Chip>
        ) : caught ? (
          <Chip size="sm" variant="primary" color="danger">draft held</Chip>
        ) : null}
        <p className="min-w-0 flex-1 truncate text-xs text-muted">&ldquo;{turn.asked}&rdquo;</p>
      </div>
      <ol className="relative ml-2 flex flex-col gap-2 border-l border-border pl-4">
        <Step index={0} title="Scribe" tone={label.answer_request ? "warn" : "ok"}>
          {label.answer_request ? "Read as a request for the answer. " : ""}
          {label.attempt_made ? "A new try was shown." : "No new try."} Concept: {label.concept.replace(/_/g, " ")}.
        </Step>
        <Step index={1} title="Policy" tone="ok">
          {policy}
        </Step>
        <Step index={2} title="Tutor" tone="ok">
          Drafted at level {level} ({LEVEL_NAME[level]}). {retries + 1} draft{retries === 0 ? "" : "s"} written. The tutor
          has no answer key.
        </Step>
        <Step index={3} title="Guard" tone={caught ? "bad" : "ok"} pulse={caught}>
          <span className="flex flex-wrap gap-1.5">
            <Chip size="sm" variant="soft" color={verdict.leaks ? "danger" : "success"}>
              {verdict.leaks ? "leak held" : "clean"}
            </Chip>
            <Chip size="sm" variant="soft">severity {verdict.severity}</Chip>
            <Chip size="sm" variant="soft">layer {verdict.layer}</Chip>
            <Chip size="sm" variant="soft" color={retries > 0 ? "warning" : "default"}>
              retries {retries}
            </Chip>
            {canaryAbsent ? (
              <Chip size="sm" variant="soft" color="success">canary absent</Chip>
            ) : null}
          </span>
          {fellBack ? (
            <span className="mt-1.5 block text-xs text-muted">The draft was held.</span>
          ) : canaryAbsent && verdict.reason ? (
            <span className="mt-1.5 block text-xs text-muted">{verdict.reason}</span>
          ) : null}
        </Step>
        <Step index={4} title="Student saw" tone={fellBack ? "warn" : "ok"}>
          {fellBack
            ? "The draft was held. Only the fallback question was shown."
            : caught
              ? "A rewritten hint. The held draft was not shown."
              : "The hint, as drafted."}
        </Step>
      </ol>
    </li>
  );
}

/** One row of the trace. Rows appear in order, a beat apart, so the eye follows the pipeline the way the server ran it. */
function Step({
  index,
  title,
  tone,
  pulse = false,
  children,
}: {
  index: number;
  title: string;
  tone: "ok" | "warn" | "bad";
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const Icon = tone === "bad" ? ShieldAlert : tone === "warn" ? ShieldCheck : Check;
  return (
    <motion.li
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.07 * index, duration: 0.22 }}
      className="relative"
    >
      <motion.span
        aria-hidden
        animate={pulse ? { scale: [1, 1.45, 1] } : undefined}
        transition={{ duration: 0.6, delay: 0.07 * index + 0.2 }}
        className={cn(
          "absolute -left-[1.6rem] top-0.5 flex size-5 items-center justify-center rounded-full border bg-background",
          tone === "bad" ? "border-danger text-danger" : tone === "warn" ? "border-warning text-warning" : "border-border text-muted",
        )}
      >
        <Icon className="size-3" />
      </motion.span>
      <p className="text-sm font-medium">{title}</p>
      <div className="text-sm text-muted">{children}</div>
    </motion.li>
  );
}
