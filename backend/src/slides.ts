// Lecture slides: the professor's PDFs, kept so students can read them, and
// read into text page by page so the tutor can cite "Lecture n, slide p".
//
// Why the file goes in MongoDB (GridFS) and not on disk: free hosts wipe the
// disk on every deploy, and the demo cannot lose its slides between a deploy
// and a judge's visit. GridFS keeps the PDF with everything else the product
// stores, so there is no seed step to re-create it and nothing to sync.
//
// What an upload has to pass, and why:
//   - At most MAX_PDF_BYTES. A lecture deck is a few MB; 20 MB leaves room
//     for one with photos and refuses something that is not a deck.
//   - The bytes start with "%PDF-". The extension and the declared type are
//     the client's word; the signature is the file's. A renamed .exe starts
//     with "MZ" and is refused here before pdf.js ever parses it.
//   - The file name the browser sent is never used as a path or a storage
//     key. The stored file has a random ObjectId; the name only becomes the
//     default title, with anything path-like stripped.
//   - pdf.js must be able to open it. A file that only claims to be a PDF is
//     refused rather than stored half-read.

import { Readable } from "node:stream";
import mongoose from "mongoose";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** The largest lecture PDF accepted. The upload route's raw body limit is the same number. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** The longest text kept for one page. A slide is a few hundred characters; this only stops a page of dense small print from swamping the tutor's context. */
const MAX_PAGE_CHARS = 4_000;

const BUCKET = "lecture_pdfs";

/** True when the bytes are a PDF by their signature, whatever the name or declared type says. */
export function looksLikePdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * A title from an uploaded file name: no directories, no extension, no
 * control characters, at most 120 characters. "../../etc/passwd.pdf" becomes
 * "passwd". The result is a label, and nothing ever uses it as a path.
 */
export function titleFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/\.pdf$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[_]+/g, " ")
    .trim()
    .slice(0, 120);
  return clean.length > 0 && clean !== "." && clean !== ".." ? clean : "Lecture slides";
}

/**
 * The text of every page, in order. Index 0 is page 1.
 *
 * pdf.js runs in Node with font loading, XFA forms, and image work off: it
 * only has to read text. (pdf.js 6 no longer compiles fonts with eval at all.)
 * A page with no text layer (a scanned slide) gives "". Throws when the
 * bytes cannot be opened as a PDF.
 */
export async function extractPages(buf: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, enableXfa: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .trim()
        .slice(0, MAX_PAGE_CHARS);
      pages.push(text);
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function bucket(): mongoose.mongo.GridFSBucket {
  const db = mongoose.connection.db;
  if (!db) throw new Error("database not connected");
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET });
}

/** Stores the PDF under a new random id and returns it. The original file name is not stored. */
export async function storePdf(buf: Buffer): Promise<mongoose.Types.ObjectId> {
  const id = new mongoose.Types.ObjectId();
  await new Promise<void>((resolve, reject) => {
    Readable.from(buf)
      .pipe(bucket().openUploadStreamWithId(id, `${id}.pdf`, { metadata: { contentType: "application/pdf" } }))
      .on("finish", () => resolve())
      .on("error", reject);
  });
  return id;
}

/** A read stream of a stored PDF. */
export function openPdf(fileId: mongoose.Types.ObjectId): NodeJS.ReadableStream {
  return bucket().openDownloadStream(fileId);
}

/** Removes a stored PDF. A file already gone is not an error: the lecture is being deleted either way. */
export async function deletePdf(fileId: mongoose.Types.ObjectId): Promise<void> {
  try {
    await bucket().delete(fileId);
  } catch (error) {
    if (!/FileNotFound|File not found/i.test(String((error as Error).message))) throw error;
  }
}

/**
 * The text the tutor searches for an assignment that names its lectures.
 *
 * One section per page, headed "Lecture n, slide p: <first line>", so the
 * existing notes search (notes.ts) treats each page as its own section and
 * cites it by that heading. Page p here is the PDF page, the same number the
 * viewer opens with #page=p, so a citation lands on the slide it names.
 * Pages with no text are left out: there is nothing in them to cite.
 */
export function slideNotes(lectures: { lecture_number: number; pages: { page_number: number; text: string }[] }[]): string {
  const sections: string[] = [];
  for (const lecture of [...lectures].sort((a, b) => a.lecture_number - b.lecture_number)) {
    for (const page of [...lecture.pages].sort((a, b) => a.page_number - b.page_number)) {
      const text = page.text.trim();
      if (!text) continue;
      const [first, ...rest] = text.split("\n");
      sections.push(`Lecture ${lecture.lecture_number}, slide ${page.page_number}: ${first}\n${rest.join("\n")}`.trim());
    }
  }
  return sections.join("\n\n");
}
