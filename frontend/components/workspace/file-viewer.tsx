"use client";

import { Button, Modal, Spinner, Tooltip } from "@heroui/react";
import { Download, FileArchive, FileCode2, FileText, Presentation } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/workspace/markdown";
import { typeLabel } from "@/components/workspace/attachments";
import { loadFile, officeText, openAs, zipEntries, type FileRef } from "@/lib/files";
import { cn } from "@/lib/utils";

/** A sent file, from this browser or the server, read into a URL for viewing. Null while loading; `missing` when neither has it. */
function useFileUrl(ref: FileRef | null): { blob: Blob | null; url: string | null; missing: boolean } {
  const key = ref?.key ?? null;
  const remote = ref?.url;
  const [state, setState] = useState<{ key: string; blob: Blob | null; url: string | null; missing: boolean } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    let url: string | null = null;
    void loadFile({ key, url: remote }).then((blob) => {
      if (!live) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setState({ key, blob, url, missing: !blob });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [key, remote]);
  return state && state.key === key ? state : { blob: null, url: null, missing: false };
}

function KindIcon({ name, className }: { name: string; className?: string }) {
  const as = openAs(name);
  if (as === "zip") return <FileArchive className={className} aria-hidden />;
  if (name.toLowerCase().endsWith(".pptx")) return <Presentation className={className} aria-hidden />;
  if (as === "text") return <FileCode2 className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

/**
 * The files a student sent, above their message, as tiles the way a chat app
 * shows them: a picture shows itself, any other file its name, with the type
 * in a badge. A tile opens the file: a document in the side panel, a picture
 * or a text file over the page. A file this browser does not have (sent from
 * another computer) says so and does not open.
 */
export function SentFileTiles({ files, onOpen }: { files: FileRef[]; onOpen: (file: FileRef) => void }) {
  return (
    <ul className="flex flex-wrap justify-end gap-2" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.key}>
          <SentTile file={f} onOpen={() => onOpen(f)} />
        </li>
      ))}
    </ul>
  );
}

function SentTile({ file, onOpen }: { file: FileRef; onOpen: () => void }) {
  const image = openAs(file.name) === "image";
  const { url, missing } = useFileUrl(image ? file : null);
  const tile = (
    <Button
      variant="ghost"
      className={cn("relative h-28 w-28 overflow-hidden rounded-xl border border-border bg-surface p-0 text-left font-normal hover:border-foreground/30", missing && "opacity-60")}
      aria-label={`Open ${file.name}`}
      onPress={onOpen}
    >
      {image && url ? (
        // A blob: URL made in this browser, so next/image has nothing to optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex flex-col gap-1.5 p-2.5">
          <KindIcon name={file.name} className="size-4 shrink-0 text-muted" />
          <span className="line-clamp-3 whitespace-normal break-words text-xs leading-4">{file.name}</span>
        </span>
      )}
      <span className="absolute bottom-1.5 left-1.5 rounded-md bg-foreground/75 px-1.5 py-0.5 text-[10px] font-medium text-background">{typeLabel(file.name)}</span>
    </Button>
  );
  if (!missing) return tile;
  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>{tile}</Tooltip.Trigger>
      <Tooltip.Content>This file could not be found.</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * A document opened in the side panel: a PDF in the browser's viewer with
 * its toolbar off, Markdown rendered, a Word or PowerPoint file as its text,
 * and a zip as the list of what is in it, with each text file readable.
 */
export function PanelFile({ file }: { file: FileRef }) {
  const { blob, url, missing } = useFileUrl(file);
  const as = openAs(file.name);
  const [text, setText] = useState<string | null>(null);
  const [entries, setEntries] = useState<{ name: string; size: number; text: string | null }[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) return;
    let live = true;
    (async () => {
      try {
        if (as === "markdown") {
          const t = await blob.text();
          if (live) setText(t);
        } else if (as === "office") {
          const t = await officeText(blob);
          if (live) setText(t);
        } else if (as === "zip") {
          const e = await zipEntries(blob);
          if (live) setEntries(e);
        }
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [blob, as]);

  if (missing) return <p className="px-5 py-8 text-center text-muted">This file could not be found.</p>;
  if (!url) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Spinner aria-label={`Opening ${file.name}`} />
      </div>
    );
  }
  if (as === "pdf") return <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={file.name} className="min-h-[24rem] w-full flex-1 bg-surface" />;
  if (failed) return <p className="px-5 py-8 text-center text-muted">This file could not be shown here. Download it to open it.</p>;
  if (as === "zip") {
    if (!entries) return <Spinner className="m-auto" aria-label="Reading the zip" />;
    const shown = entries.find((e) => e.name === openEntry);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {entries.map((e) => (
            <li key={e.name}>
              <Button variant="ghost" className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 font-normal" isDisabled={e.text === null} onPress={() => setOpenEntry(e.name === openEntry ? null : e.name)}>
                <KindIcon name={e.name} className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-left font-mono text-sm">{e.name}</span>
                <span className="text-xs text-muted">{(e.size / 1024).toFixed(1)} KB</span>
              </Button>
            </li>
          ))}
        </ul>
        {shown?.text != null ? <TextBody name={shown.name} text={shown.text} /> : null}
      </div>
    );
  }
  if (text === null) return <Spinner className="m-auto" aria-label={`Reading ${file.name}`} />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <Markdown text={text} />
    </div>
  );
}

/** A text or code file's contents: Markdown rendered, anything else in the mono face with line numbers. */
function TextBody({ name, text }: { name: string; text: string }) {
  if (openAs(name) === "markdown") return <Markdown text={text} />;
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <pre className="overflow-auto rounded-xl border border-border bg-surface py-3 font-mono text-[13px] leading-6">
      {lines.map((l, i) => (
        <div key={i} className="flex">
          <span className="w-10 shrink-0 select-none pr-3 text-right text-muted/60">{i + 1}</span>
          <span className="whitespace-pre pr-4">{l || " "}</span>
        </div>
      ))}
    </pre>
  );
}

/** The download link for a kept file, for the panel header and the lightbox. */
export function FileDownload({ file }: { file: FileRef }) {
  const { url } = useFileUrl(file);
  if (!url) return null;
  return (
    <Tooltip delay={300}>
      <a href={url} download={file.name} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-default hover:text-foreground" aria-label={`Download ${file.name}`}>
        <Download className="size-4" aria-hidden />
      </a>
      <Tooltip.Content>Download</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * A picture or a text file opened over the page, with its name, a download
 * link, and a close button. Escape or a click outside closes it.
 */
export function FileLightbox({ file, onClose }: { file: FileRef | null; onClose: () => void }) {
  const { url, blob, missing } = useFileUrl(file);
  const [text, setText] = useState<string | null>(null);
  const kind = file ? openAs(file.name) : "text";
  const isImage = kind === "image";
  // A document (PDF, Markdown, Word, PowerPoint, zip) is shown with the same viewer the side panel uses, inside this window.
  const isDocument = kind !== "image" && kind !== "text";
  useEffect(() => {
    if (!blob || isImage || isDocument) return;
    let live = true;
    void blob.text().then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [blob, isImage, isDocument]);

  return (
    <Modal>
      <Modal.Backdrop isOpen={file !== null} onOpenChange={(open) => !open && onClose()} variant="blur">
        <Modal.Container size="lg" scroll="inside">
          {/* The size variant sets the dialog's width, so the wider viewer is set on the dialog itself. */}
          <Modal.Dialog aria-label={file?.name ?? "File"} className={cn("flex max-h-[90dvh] max-w-none flex-col", isImage ? "w-auto min-w-[min(28rem,94vw)]" : isDocument ? "h-[86dvh] w-[min(64rem,94vw)]" : "w-[min(56rem,94vw)]")}>
            <Modal.Header className="flex flex-row items-center gap-2">
              <Modal.Heading className="min-w-0 flex-1 truncate text-sm font-medium">{file?.name}</Modal.Heading>
              {file ? <FileDownload file={file} /> : null}
              <Modal.CloseTrigger className="static" />
            </Modal.Header>
            <Modal.Body className={cn("min-h-0", isDocument ? "flex flex-1 flex-col overflow-hidden p-0" : "overflow-auto")}>
              {file && isDocument ? (
                <PanelFile file={file} />
              ) : missing ? (
                <p className="py-8 text-center text-muted">This file could not be found.</p>
              ) : !url ? (
                <div className="flex justify-center py-10">
                  <Spinner aria-label="Opening the file" />
                </div>
              ) : isImage ? (
                // A blob: URL made in this browser, so next/image has nothing to optimize.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={file?.name ?? ""} className="mx-auto max-h-[75dvh] w-auto rounded-lg object-contain" />
              ) : text === null ? (
                <div className="flex justify-center py-10">
                  <Spinner aria-label="Reading the file" />
                </div>
              ) : (
                <TextBody name={file?.name ?? ""} text={text} />
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
