import { useSyncExternalStore } from "react";

/**
 * True when the viewport matches a media query, kept in step as the window
 * resizes. Read with useSyncExternalStore so a resize re-renders without an
 * effect. The server render, which has no window, answers `false`, so the
 * first paint is the narrow layout and the wide one follows on the client.
 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
