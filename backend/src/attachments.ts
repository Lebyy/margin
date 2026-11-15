// Files a student attaches to a message: PDFs, pictures, text and code, Word
// and PowerPoint files, and zips of those.
//
// A file is read here once, when it is uploaded, into what the tutor can use:
// text (capped) and pictures (capped). The original bytes are saved in the
// blob store (storage.ts) under the session and a random id, so the student
// and the professor can open the file later from any computer. The extracted
// text and pictures are held for one hour in this process's memory, so the
// message that names the id can send them to the tutor; the message then
// records the file's name, kind, and where it is stored.
//
// Everything in a file is the student's material, never instructions. That
// holds three ways. The tutor reads file text between markers, and any marker
// spelled inside the file is defaced here, so a file cannot close its own
// section and start a new one. The tutor's prompt says what is between the
// markers is data. And the guard reads every draft against the answer key
// after the tutor writes it, so a file that talks the tutor round still cannot
// get the solution past the guard.
//
// A file is also untrusted bytes. The kind is decided by its first bytes, not
// its name. Every axis has a limit: the upload size, the number of pages read
// from a PDF, the number of entries in a zip, the size each entry says it
// unpacks to, the total of those, and the ratio between packed and unpacked
// (the shape of a zip bomb). An entry is inflated into a buffer of the size it
// declared, so it cannot grow past the limits that were checked. A zip inside
// a zip is not opened.

import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";
import { extractPages } from "./slides.ts";
import { blobs } from "./storage.ts";

/** The most one upload may be. The JSON body that carries it as base64 is a third larger, and the server reads bodies up to 10 MB. */
export const MAX_FILE_BYTES = 7 * 1024 * 1024;
/** Text kept from one file. A long PDF is cut, and the student is told so. */
export const MAX_FILE_CHARS = 20_000;
/** Pages read from one PDF. */
const MAX_PDF_PAGES = 40;
/** Pictures kept from one file (a zip of photos). */
const MAX_FILE_IMAGES = 4;
/** One picture's largest size, packed. Larger pictures are left out with a note. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Zip limits: entries, the size one entry and all entries say they unpack to, and the packed-to-unpacked ratio. */
const MAX_ZIP_ENTRIES = 60;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ZIP_TOTAL = 24 * 1024 * 1024;
const MAX_RATIO = 100;
/** How long an uploaded file waits for its message, and how many may wait at once. */
const TTL_MS = 60 * 60 * 1000;
const MAX_WAITING = 500;

export type AttachmentKind = "pdf" | "image" | "text" | "document" | "archive";

/** What a file became: its text and pictures for the tutor, and notes on what was left out. */
export type Extracted = { kind: AttachmentKind; text: string; images: { mimeType: string; base64: string }[]; notes: string[] };

/** A file waiting for its message. `sessionId` ties it to one conversation: another session cannot use the id. */
export type Attachment = Extracted & { id: string; sessionId: string; name: string; bytes: number; created: number; storageKey: string; contentType: string };

/** Thrown for a file that is not accepted. `code` is the error the route sends; `message` is the sentence the student reads. */
export class AttachmentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const waiting = new Map<string, Attachment>();

/** Reads one uploaded file, keeps what the tutor can use under a new id, and returns it. Throws AttachmentError for a file that is refused. */
export async function addAttachment(sessionId: string, name: string, bytes: Buffer): Promise<Attachment> {
  if (bytes.length === 0) throw new AttachmentError("empty_file", "The file is empty.");
  if (bytes.length > MAX_FILE_BYTES) throw new AttachmentError("file_too_large", `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const extracted = await extract(cleanName(name), bytes, 0);
  if (!extracted.text.trim() && extracted.images.length === 0) throw new AttachmentError("nothing_readable", "Nothing in this file could be read.");
  sweep();
  const id = randomUUID();
  // The original file, kept whole. A refused file never reaches this line, so the store only holds files Askretes could read.
  const storageKey = `attachments/${sessionId}/${id}`;
  const contentType = contentTypeOf(name, extracted.kind, bytes);
  await blobs().put(storageKey, bytes, contentType);
  const attachment: Attachment = { ...extracted, id, sessionId, name: cleanName(name), bytes: bytes.length, created: Date.now(), storageKey, contentType };
  waiting.set(attachment.id, attachment);
  while (waiting.size > MAX_WAITING) waiting.delete(waiting.keys().next().value as string);
  return attachment;
}

/** The attachments a message names, if every one exists and belongs to this session. Null otherwise, so a message cannot borrow another conversation's files. */
export function takeAttachments(sessionId: string, ids: string[]): Attachment[] | null {
  sweep();
  const found = ids.map((id) => waiting.get(id));
  if (found.some((a) => !a || a.sessionId !== sessionId)) return null;
  return found as Attachment[];
}

/**
 * The type a stored file is served back with. Read from the bytes where they say (a picture, a PDF), from the name for Office files, and plain text for anything read as text, so a file named .html is served as text and never runs as a page.
 */
function contentTypeOf(name: string, kind: AttachmentKind, bytes: Buffer): string {
  const image = imageType(bytes);
  if (image) return image;
  if (kind === "pdf") return "application/pdf";
  if (kind === "text") return "text/plain; charset=utf-8";
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/zip";
}

/** An uploaded file that has not been sent yet, if it belongs to this session. Used to serve the file back before its message exists. */
export function waitingAttachment(sessionId: string, id: string): Attachment | null {
  const a = waiting.get(id);
  return a && a.sessionId === sessionId ? a : null;
}

function sweep(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, a] of waiting) if (a.created < cutoff) waiting.delete(id);
}

/** A file name as it is shown and stored: the last path part, printable characters only, at most 120 of them. */
function cleanName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "file";
  return last.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, "").trim().slice(0, 120) || "file";
}

/**
 * What one file holds. The kind is read from the bytes: a PDF, a picture, a
 * zip (and inside it, a Word or PowerPoint file), or text. `depth` is how deep
 * in a zip this file sits; a zip inside a zip is listed, not opened.
 */
export async function extract(name: string, bytes: Buffer, depth: number): Promise<Extracted> {
  const image = imageType(bytes);
  if (image) {
    if (bytes.length > MAX_IMAGE_BYTES) return { kind: "image", text: "", images: [], notes: [`${name}: the picture is larger than 4 MB and was left out.`] };
    return { kind: "image", text: "", images: [{ mimeType: image, base64: bytes.toString("base64") }], notes: [] };
  }
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return readPdf(name, bytes);
  if (bytes.subarray(0, 4).toString("latin1") === "PK\x03\x04") {
    if (depth > 0) return { kind: "archive", text: "", images: [], notes: [`${name}: a zip inside a zip is not opened.`] };
    return readZip(name, bytes);
  }
  const text = asText(bytes);
  if (text === null) throw new AttachmentError("unsupported_file", `${name}: this kind of file cannot be read. Try a PDF, a picture, a text or code file, a Word or PowerPoint file, or a zip of those.`);
  return { kind: "text", ...capText(name, text), images: [] };
}

function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** UTF-8 text, or null for bytes that are not text (a NUL in the first 8 KB, or bytes that do not decode). */
function asText(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8192).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function readPdf(name: string, bytes: Buffer): Promise<Extracted> {
  let pages: string[];
  try {
    pages = await extractPages(bytes);
  } catch {
    throw new AttachmentError("unreadable_pdf", `${name}: the PDF could not be opened.`);
  }
  const notes: string[] = [];
  if (pages.length > MAX_PDF_PAGES) notes.push(`${name}: only the first ${MAX_PDF_PAGES} of ${pages.length} pages were read.`);
  const kept = pages.slice(0, MAX_PDF_PAGES);
  const text = kept.map((p, i) => `[page ${i + 1}]\n${p}`).join("\n\n");
  if (!kept.some((p) => p.trim())) notes.push(`${name}: the PDF has no text layer (it may be scanned). Attach the pages as pictures instead.`);
  const capped = capText(name, text);
  return { kind: "pdf", text: capped.text, images: [], notes: [...notes, ...capped.notes] };
}

/**
 * A zip, or a Word or PowerPoint file (which are zips of XML).
 *
 * The central directory is read first, through the filter, and nothing is
 * inflated until every entry has passed: at most MAX_ZIP_ENTRIES files, each
 * declaring at most MAX_ENTRY_BYTES unpacked, all together at most
 * MAX_ZIP_TOTAL, and none packed more than MAX_RATIO times smaller than it
 * unpacks. A file that breaks any of those is refused whole. Folders and the
 * metadata a Mac adds are skipped.
 */
function readZip(name: string, bytes: Buffer): Extracted {
  const listed: UnzipFileInfo[] = [];
  try {
    unzipSync(new Uint8Array(bytes), { filter: (f) => (listed.push(f), false) });
  } catch {
    throw new AttachmentError("unreadable_zip", `${name}: the zip could not be opened.`);
  }
  const entries = listed.filter((f) => !f.name.endsWith("/") && !f.name.startsWith("__MACOSX/") && !f.name.split("/").pop()!.startsWith("._"));
  if (entries.length > MAX_ZIP_ENTRIES) throw new AttachmentError("zip_too_many_files", `${name}: a zip can hold up to ${MAX_ZIP_ENTRIES} files.`);
  let total = 0;
  for (const f of entries) {
    total += f.originalSize;
    const ratio = f.originalSize / Math.max(1, f.size);
    if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_ZIP_TOTAL || (f.originalSize > 1024 * 1024 && ratio > MAX_RATIO)) {
      throw new AttachmentError("zip_too_large", `${name}: the zip unpacks to more than Askretes reads. Attach fewer or smaller files.`);
    }
    if (f.compression !== 0 && f.compression !== 8) throw new AttachmentError("unreadable_zip", `${name}: the zip uses a compression Askretes cannot read.`);
  }

  const wanted = new Set(entries.map((f) => f.name));
  let files: Record<string, Uint8Array>;
  try {
    // Each entry is inflated into a buffer of the size it declared, so it cannot grow past what was checked above.
    files = unzipSync(new Uint8Array(bytes), { filter: (f) => wanted.has(f.name) });
  } catch {
    throw new AttachmentError("unreadable_zip", `${name}: the zip could not be opened.`);
  }

  if (files["word/document.xml"]) return { kind: "document", ...capText(name, xmlText(strFromU8(files["word/document.xml"]), /<\/w:p>/g)), images: [] };
  const slides = Object.keys(files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/g)!.pop()) - Number(b.match(/\d+/g)!.pop()));
  if (slides.length) {
    const text = slides.map((n, i) => `[slide ${i + 1}]\n${xmlText(strFromU8(files[n]), /<\/a:p>/g)}`).join("\n\n");
    return { kind: "document", ...capText(name, text), images: [] };
  }

  // A plain zip: each file inside is read as if it had been attached on its own, one level deep.
  return readZipEntries(name, files);
}

function readZipEntries(name: string, files: Record<string, Uint8Array>): Extracted {
  const parts: string[] = [];
  const images: { mimeType: string; base64: string }[] = [];
  const notes: string[] = [];
  for (const [entry, data] of Object.entries(files)) {
    const buf = Buffer.from(data);
    const image = imageType(buf);
    if (image) {
      if (images.length < MAX_FILE_IMAGES && buf.length <= MAX_IMAGE_BYTES) images.push({ mimeType: image, base64: buf.toString("base64") });
      else notes.push(`${name}/${entry}: picture left out.`);
      continue;
    }
    if (buf.subarray(0, 4).toString("latin1") === "PK\x03\x04") {
      notes.push(`${name}/${entry}: a zip inside a zip is not opened.`);
      continue;
    }
    if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
      notes.push(`${name}/${entry}: attach PDFs on their own, not inside a zip.`);
      continue;
    }
    const text = asText(buf);
    if (text === null) {
      notes.push(`${name}/${entry}: not a file Askretes can read.`);
      continue;
    }
    parts.push(`[${entry}]\n${text}`);
  }
  const capped = capText(name, parts.join("\n\n"));
  return { kind: "archive", text: capped.text, images, notes: [...notes, ...capped.notes] };
}

/** The words in Office XML: paragraph ends become new lines, every tag is dropped, and the five XML entities are decoded. */
function xmlText(xml: string, paragraphEnd: RegExp): string {
  return xml
    .replace(paragraphEnd, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Text as the tutor will read it: control characters other than new lines and tabs removed, the prompt's section markers defaced so the file cannot end its own section, and cut at MAX_FILE_CHARS with a note.
 */
function capText(name: string, text: string): { text: string; notes: string[] } {
  const clean = neutralize(text);
  if (clean.length <= MAX_FILE_CHARS) return { text: clean, notes: [] };
  return { text: clean.slice(0, MAX_FILE_CHARS), notes: [`${name}: only the first ${MAX_FILE_CHARS.toLocaleString("en-US")} characters were read.`] };
}

/** Removes control characters and defaces the tutor prompt's markers (<<< and >>>), which a file must never be able to write. */
export function neutralize(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .replace(/<{3,}/g, "‹‹‹")
    .replace(/>{3,}/g, "›››");
}
