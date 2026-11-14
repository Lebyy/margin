// Turns the file the student picked into what the vision route accepts.
//
// The photo is redrawn onto a canvas and sent as a JPEG no larger than
// MAX_SIDE on its longest edge. Two reasons. A phone photo is often 4-12 MB,
// and the API refuses bodies over 10 MB, so an unscaled photo would fail on
// the wire for a reason the student cannot see. And the box the server
// returns is in 0-to-1 units of the image it was sent; the page shows that
// same encoded image, so the ellipse lands where the model put it. Showing
// the original file instead would be fine only while the aspect ratio matched,
// and EXIF rotation is exactly where it does not.

/** Long enough to read handwriting, small enough to stay well under the body limit. */
const MAX_SIDE = 1600;

/** The types the picker offers. The server also lists HEIC, but browsers cannot draw it onto a canvas. */
export const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp";

export type PreparedPhoto = {
  /** A data: URL of the encoded image, for the page to show. It stays in the browser. */
  src: string;
  mimeType: "image/jpeg";
  /** The same bytes without the data: prefix, for the request body. */
  base64: string;
};

/**
 * Decodes, scales, and re-encodes one picked file, or throws if the browser
 * cannot read it. createImageBitmap applies the photo's EXIF rotation, so a
 * phone picture taken sideways is upright before the model sees it.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  // A transparent PNG would turn black as a JPEG. White is the page the work was written on.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const src = canvas.toDataURL("image/jpeg", 0.85);
  return { src, mimeType: "image/jpeg", base64: src.slice(src.indexOf(",") + 1) };
}
