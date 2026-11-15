// Which web pages may call this API and open a Talk socket.
//
// The browser sends every request from the student or professor page, so the
// API answers only the origins listed here: the CORS check on HTTP routes and
// the origin check on the Talk upgrade both read this one list, so a deployed
// site can never be allowed on one and refused on the other. Locally the list
// is the Next.js dev server; a deployment sets WEB_ORIGINS to its own address
// (comma-separated, e.g. "https://askretes.vercel.app,http://localhost:3000").
// Widening this to "*" would let any site on the internet spend the model
// credit and open voice sessions through this API.

const DEFAULT = ["http://localhost:3000"];

/** The allowed origins, without trailing slashes, from WEB_ORIGINS or the dev default. */
export function webOrigins(): string[] {
  const list = (process.env.WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return list.length ? list : DEFAULT;
}
