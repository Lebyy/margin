import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class-name helper the Animate UI and shadcn components import.
 * twMerge resolves two utilities that set the same property, so a `className` passed by a page wins over the component's default instead of both landing in the HTML and the stylesheet order deciding.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
