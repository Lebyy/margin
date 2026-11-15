"use client";

import { Button, Spinner, Tooltip } from "@heroui/react";
import { FileArchive, FileCode2, FileText, Image as ImageIcon, Presentation, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AttachmentInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

/** What the file picker offers. The server decides what a file is from its bytes; this list only steers the picker toward files Askretes can read. */
export const ATTACH_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.markdown,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.rb,.php,.swift,.kt,.m,.r,.sql,.json,.csv,.tex,.html,.css,.xml,.yaml,.yml,.ipynb,.docx,.pptx,.zip";

/** The same limits the server enforces, checked here first so a file that would be refused says so at once. */
export const MAX_ATTACH_BYTES = 7 * 1024 * 1024;
export const MAX_ATTACH_FILES = 8;

/** One file in the message box: being read by the server, ready (with what was read), or refused (with why). */
export type PendingFile = {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "ready" | "error";
  info?: AttachmentInfo;
  error?: string;
  /** A local preview of a picture, made in this browser. Revoked when the tile goes. */
  preview?: string;
  /** The file itself, kept in this browser when it is sent so the student can open it from the conversation (lib/files.ts). */
  file?: File;
};

/** The short type label on a tile: the file's extension, upper-cased, as a chat app shows it. */
export function typeLabel(name: string): string {
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  return ext && ext.length <= 5 && ext !== name.toUpperCase() ? ext : "FILE";
}

function KindIcon({ name, className }: { name: string; className?: string }) {
  const ext = typeLabel(name);
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP"].includes(ext)) return <ImageIcon className={className} aria-hidden />;
  if (ext === "ZIP") return <FileArchive className={className} aria-hidden />;
  if (ext === "PPTX") return <Presentation className={className} aria-hidden />;
  if (["PDF", "DOCX", "TXT", "MD", "MARKDOWN"].includes(ext)) return <FileText className={className} aria-hidden />;
  return <FileCode2 className={className} aria-hidden />;
}

/**
 * One file waiting in the message box, as a square tile.
 *
 * A picture shows itself; any other file shows its name. The type sits in a
 * badge at the bottom, and the remove button at the top right. While the
 * server reads the file the tile dims under a spinner; a refused file gets a
 * red edge and the server's sentence in its tooltip and accessible name, so
 * the student knows what to change. A file read with something left out
 * (a long PDF cut short) says that in its tooltip too.
 */
export function AttachmentTile({ file, onRemove }: { file: PendingFile; onRemove: () => void }) {
  const note = file.status === "error" ? file.error : file.info?.notes.length ? file.info.notes.join(" ") : null;
  const label = `${file.name}${file.status === "uploading" ? ", reading" : file.status === "error" ? `, not attached: ${file.error}` : ""}`;
  const tile = (
    <div
      role="group"
      aria-label={label}
      className={cn("relative size-28 shrink-0 overflow-hidden rounded-xl border bg-surface", file.status === "error" ? "border-danger" : "border-border")}
    >
      {file.preview ? (
        // A blob: URL made in this browser, so next/image has nothing to optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.preview} alt="" className={cn("size-full object-cover", file.status !== "ready" && "opacity-50")} />
      ) : (
        <div className={cn("flex size-full flex-col gap-1.5 p-2.5", file.status !== "ready" && "opacity-60")}>
          <KindIcon name={file.name} className="size-4 shrink-0 text-muted" />
          <p className="line-clamp-3 break-words text-xs leading-4">{file.name}</p>
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-foreground/75 px-1.5 py-0.5 text-[10px] font-medium text-background">{typeLabel(file.name)}</span>
      {file.status === "uploading" ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" aria-label={`Reading ${file.name}`} />
        </span>
      ) : null}
      <Button isIconOnly size="sm" variant="secondary" className="absolute right-1 top-1 size-6 min-w-6 rounded-full shadow-sm" aria-label={`Remove ${file.name}`} onPress={onRemove}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
  if (!note) return tile;
  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>{tile}</Tooltip.Trigger>
      <Tooltip.Content className="max-w-64">{note}</Tooltip.Content>
    </Tooltip>
  );
}

/** A file's bytes as base64, for the JSON upload. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Revokes a tile's preview URL when the tile is gone, so a long conversation does not hold every picture in memory. */
export function useRevokeOnRemove(files: PendingFile[]) {
  const seen = useRef<string[]>([]);
  useEffect(() => {
    const now = files.flatMap((f) => (f.preview ? [f.preview] : []));
    seen.current.filter((u) => !now.includes(u)).forEach((u) => URL.revokeObjectURL(u));
    seen.current = now;
  }, [files]);
}
