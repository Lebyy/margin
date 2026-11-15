"use client";

import { Button, Tooltip } from "@heroui/react";
import { AudioLines } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { startLive } from "@/lib/live-talk";

/**
 * Opens and closes Talk.
 *
 * The button is the whole control: one press starts the microphone, the next
 * hangs up. Captions are handed to the page so they land in the same thread
 * as a typed hint. A held reply is spoken by the browser, because the server
 * does not send the audio it refused.
 */
export function TalkButton({
  sessionId,
  isDisabled = false,
  onCaption,
  onError,
}: {
  sessionId: string;
  isDisabled?: boolean;
  onCaption: (role: "student" | "tutor", text: string, partial: boolean) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "connecting" | "live">("idle");
  const hangup = useRef<(() => void) | null>(null);
  const live = phase === "live";

  async function toggle() {
    if (hangup.current) {
      hangup.current();
      hangup.current = null;
      setPhase("idle");
      return;
    }
    setPhase("connecting");
    try {
      hangup.current = await startLive(sessionId, {
        onCaption: (caption) => onCaption(caption.role, caption.text, caption.partial),
        onError,
        onEnd: () => {
          hangup.current = null;
          setPhase("idle");
        },
      });
      setPhase("live");
    } catch (error) {
      setPhase("idle");
      onError(error instanceof Error ? error.message : "Voice is not available right now.");
    }
  }

  return (
    <span className="relative inline-flex">
      {live ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-margin-red"
          animate={{ scale: [1, 1.35], opacity: [0.7, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <Tooltip delay={300}>
        <Button size="sm" variant={live ? "danger-soft" : "ghost"} aria-label={live ? "Stop talking" : "Talk to Askretes"} aria-pressed={live} isDisabled={isDisabled || phase === "connecting"} isPending={phase === "connecting"} onPress={() => void toggle()}>
          <AudioLines className="size-4" />
          {live ? "Stop" : "Talk"}
        </Button>
        <Tooltip.Content>Talks out loud. Your name is not sent.</Tooltip.Content>
      </Tooltip>
    </span>
  );
}
