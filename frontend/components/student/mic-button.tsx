"use client";

import { Button } from "@heroui/react";
import { Mic } from "lucide-react";
import { motion } from "motion/react";
import { useCanDictate, useDictation } from "@/lib/speech";

/**
 * The dictation button beside a text field.
 *
 * It renders nothing in a browser that cannot transcribe speech, so there is
 * never a mic that does nothing. While listening, a ring pulses around it.
 * That pulse is the one looping animation in the product, and it is a status:
 * it says the microphone is live, and it stops when listening stops.
 */
export function MicButton({ onText, isDisabled = false }: { onText: (text: string) => void; isDisabled?: boolean }) {
  const supported = useCanDictate();
  const { listening, toggle } = useDictation(onText);
  if (!supported) return null;
  return (
    <span className="relative inline-flex">
      {listening ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border border-margin-red"
          animate={{ scale: [1, 1.5], opacity: [0.7, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <Button isIconOnly size="sm" variant={listening ? "danger-soft" : "ghost"} aria-label={listening ? "Stop listening" : "Speak"} aria-pressed={listening} isDisabled={isDisabled} onPress={toggle}>
        <Mic className="size-4" />
      </Button>
    </span>
  );
}
