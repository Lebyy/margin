// The files a student sent, kept in their own browser so they can open them
// again from the conversation.
//
// The server keeps every attached file (backend storage.ts) and serves it by
// its id. This browser also keeps a copy of each file it sent, in IndexedDB
// under the session and the name, so opening one is instant and works while
// the server is unreachable. A file this browser does not have (sent from
// another computer) is fetched from the server and then kept here too.
// Switching student profiles deletes this copy with the canvas
// (browser.chooseStudent); the server's copy stays with the class.
//
// Opening a file never sends it anywhere. A document opens in the side panel
// (a PDF in the browser's viewer, Markdown and Word and PowerPoint as text
// read here), and a picture or a plain text or code file opens over the page.

import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

export const FILES_DB = "margin-files";
const STORE = "files";

/** A sent file as the page refers to it: its name, its kind as the server read it, the key it is kept under here, and where the server serves it. */
export type FileRef = { name: string; kind?: string; key: string; url?: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(FILES_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The key a file is kept under: its session and its name. A second file with the same name in the same conversation replaces the first. */
export function fileKey(sessionId: string, name: string): string {
  return `${sessionId}|${name}`;
}

export async function keepFile(key: string, file: Blob & { name?: string }): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(file, key);
  } catch {
    // IndexedDB blocked: the file can be opened during this visit only.
  }
}

/** The file from this browser, or else from the server (and then kept here). Null when neither has it. */
export async function loadFile(ref: { key: string; url?: string }): Promise<Blob | null> {
  const local = await findFile(ref.key);
  if (local || !ref.url) return local;
  try {
    const res = await fetch(ref.url, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    void keepFile(ref.key, blob);
    return blob;
  } catch {
    return null;
  }
}

export async function findFile(key: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** How a file opens: in the side panel as a document, or over the page as a picture or a text. */
export type OpenAs = "pdf" | "markdown" | "office" | "zip" | "image" | "text";

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp"];
const MARKDOWN = ["md", "markdown"];

export function openAs(name: string): OpenAs {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (MARKDOWN.includes(ext)) return "markdown";
  if (ext === "docx" || ext === "pptx") return "office";
  if (ext === "zip") return "zip";
  if (IMAGE.includes(ext)) return "image";
  return "text";
}

/** Whether a file opens in the side panel (a document) or over the page. */
export function opensInPanel(name: string): boolean {
  return ["pdf", "markdown", "office", "zip"].includes(openAs(name));
}

/** The most a file is unpacked to for viewing, the same order of limits the server keeps, so a large or hostile file cannot stall the page. */
const MAX_VIEW_ENTRY = 8 * 1024 * 1024;
const MAX_VIEW_TOTAL = 24 * 1024 * 1024;

/**
 * The text of a Word or PowerPoint file, read here for viewing: paragraphs of
 * a Word document, slide by slide for PowerPoint. The zip's directory is
 * checked against the limits before anything is unpacked.
 */
export async function officeText(blob: Blob): Promise<string> {
  const files = safeUnzip(new Uint8Array(await blob.arrayBuffer()), (n) => n === "word/document.xml" || /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (files["word/document.xml"]) return xmlText(strFromU8(files["word/document.xml"]), /<\/w:p>/g);
  const slides = Object.keys(files).sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  return slides.map((n, i) => `## Slide ${i + 1}\n\n${xmlText(strFromU8(files[n]), /<\/a:p>/g)}`).join("\n\n");
}

/** The files in a zip, with the text of each text file, for viewing. Pictures are listed by name. */
export async function zipEntries(blob: Blob): Promise<{ name: string; size: number; text: string | null }[]> {
  const files = safeUnzip(new Uint8Array(await blob.arrayBuffer()), (n) => !n.endsWith("/") && !n.startsWith("__MACOSX/"));
  return Object.entries(files).map(([name, data]) => {
    let text: string | null = null;
    if (!data.subarray(0, 8192).includes(0)) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        text = null;
      }
    }
    return { name, size: data.length, text };
  });
}

function safeUnzip(bytes: Uint8Array, want: (name: string) => boolean): Record<string, Uint8Array> {
  const listed: UnzipFileInfo[] = [];
  unzipSync(bytes, { filter: (f) => (listed.push(f), false) });
  let total = 0;
  for (const f of listed.filter((f) => want(f.name))) {
    total += f.originalSize;
    if (f.originalSize > MAX_VIEW_ENTRY || total > MAX_VIEW_TOTAL) throw new Error("too_large");
  }
  return unzipSync(bytes, { filter: (f) => want(f.name) && (f.compression === 0 || f.compression === 8) });
}

function xmlText(xml: string, paragraphEnd: RegExp): string {
  return xml
    .replace(paragraphEnd, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
