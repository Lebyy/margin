"use client";

import { Avatar, Dropdown, Label } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { browser } from "@/lib/browser";
import { initials, PROF_PROFILES, STUDENT_PROFILES, type Profile } from "@/lib/profiles";

/**
 * The profile switcher at the top right of the header.
 *
 * On the student side it lists the student profiles; on the "I teach" side
 * (any /prof page) it lists the professor profiles. The two lists never
 * appear together, so a student screen never offers a professor's view.
 *
 * Choosing a student asks the server for that student by name (found, or
 * created the first time) and enrolls them in their class, then reloads the
 * home page as them. The reload is deliberate: every page reads the student
 * from this browser when it loads, and a full load is the one way to be sure
 * nothing from the previous student is still on screen. Choosing a
 * professor sets the professor name the class list filters by, and opens it.
 */
export function ProfileMenu({ side }: { side: "student" | "prof" }) {
  const profiles: Profile[] = side === "prof" ? PROF_PROFILES : STUDENT_PROFILES;
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Read after mount, so the server render (which has no storage) and the first client render agree.
  useEffect(() => {
    const id = window.setTimeout(() => setCurrent(side === "prof" ? browser.profProfile() : browser.studentProfile()), 0);
    return () => window.clearTimeout(id);
  }, [side]);

  async function choose(name: string) {
    const profile = profiles.find((p) => p.name === name);
    if (!profile || busy) return;
    setFailed(false);
    if (profile.kind === "prof") {
      browser.chooseProf(profile.name);
      fullLoad("/prof/courses");
      return;
    }
    setBusy(true);
    try {
      const r = await api.profileStudent(profile.name, profile.courseName);
      browser.chooseStudent(r.student_id, profile.name);
      fullLoad("/");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  const label = current ?? (side === "prof" ? "Choose professor" : "Choose student");

  return (
    <Dropdown>
      <Dropdown.Trigger className="flex shrink-0 items-center gap-2 rounded-full px-1.5 py-1 hover:bg-default" aria-label={`Profile: ${label}`} isDisabled={busy}>
        <Avatar size="sm" color={side === "prof" ? "accent" : "default"}>
          <Avatar.Fallback>{current ? initials(current) : "?"}</Avatar.Fallback>
        </Avatar>
        <span className="hidden max-w-36 truncate text-sm sm:inline">{failed ? "Could not switch" : label}</span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label={side === "prof" ? "Professor profiles" : "Student profiles"}
          selectionMode="single"
          selectedKeys={current ? [current] : []}
          onAction={(key) => void choose(String(key))}
        >
          <Dropdown.Section>
            {profiles.map((p) => (
              <Dropdown.Item key={p.name} id={p.name} textValue={p.name}>
                <Avatar size="sm" color={side === "prof" ? "accent" : "default"}>
                  <Avatar.Fallback>{initials(p.name)}</Avatar.Fallback>
                </Avatar>
                <div className="flex flex-col">
                  <Label>{p.name}</Label>
                  <span className="text-xs text-muted">{p.courseName}</span>
                </div>
                <Dropdown.ItemIndicator />
              </Dropdown.Item>
            ))}
          </Dropdown.Section>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * A full page load, not a client-side navigation. After a switch every page
 * must read the new profile from storage as it mounts; a soft navigation to
 * the page already open would keep the previous person's state on screen.
 */
function fullLoad(path: string) {
  window.location.href = new URL(path, window.location.href).href;
}
