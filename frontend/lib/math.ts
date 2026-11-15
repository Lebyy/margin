// LaTeX, typeset in the browser by MathJax into SVG.
//
// One renderer serves both places math appears: Askretes' replies in the chat,
// and formulas the tutor writes on the canvas. SVG is the output for both,
// because the chat can show it inline and the canvas can take it as a picture
// (Excalidraw draws images, not HTML).
//
// What it cannot do is the reason it is safe to put in the page. Only the
// TeX packages registered below are loaded: base, ams, boldsymbol, cancel,
// and the two that turn an unknown command or a parse error into visible
// text instead of a thrown error. None of them can make a link, run a
// script, load a file, or emit HTML (those are the `html`, `href`, and
// `require` packages, which are not imported). The output is SVG drawn from
// MathJax's own glyph paths. As a second fence, any href or event attribute
// that ever appeared in the markup is removed before it is used.
//
// MathJax is imported inside the function, so the server render of a page
// never loads it.

type Renderer = (tex: string, display: boolean) => string;

let ready: Promise<Renderer> | null = null;

function load(): Promise<Renderer> {
  if (!ready) {
    ready = (async () => {
      const [{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
        import("mathjax-full/js/mathjax.js"),
        import("mathjax-full/js/input/tex.js"),
        import("mathjax-full/js/output/svg.js"),
        import("mathjax-full/js/adaptors/liteAdaptor.js"),
        import("mathjax-full/js/handlers/html.js"),
      ]);
      await Promise.all([
        import("mathjax-full/js/input/tex/base/BaseConfiguration.js"),
        import("mathjax-full/js/input/tex/ams/AmsConfiguration.js"),
        import("mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js"),
        import("mathjax-full/js/input/tex/cancel/CancelConfiguration.js"),
        import("mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js"),
        import("mathjax-full/js/input/tex/noerrors/NoErrorsConfiguration.js"),
      ]);
      const adaptor = liteAdaptor();
      RegisterHTMLHandler(adaptor);
      const doc = mathjax.document("", {
        InputJax: new TeX({ packages: ["base", "ams", "boldsymbol", "cancel", "noundefined", "noerrors"] }),
        // Glyphs are written into each SVG, so a formula stands alone as a picture on the canvas.
        OutputJax: new SVG({ fontCache: "none" }),
      });
      return (tex, display) => {
        const node = doc.convert(tex, { display });
        const svg = adaptor.innerHTML(node);
        return svg.replace(/\s(?:xlink:)?href="[^"]*"/gi, "").replace(/\son[a-z]+="[^"]*"/gi, "");
      };
    })();
  }
  return ready;
}

/** A formula as an SVG string, sized in ex units so it matches the text around it. Null if MathJax could not be loaded. */
export async function texToSvg(tex: string, display = false): Promise<string | null> {
  try {
    const render = await load();
    return render(tex, display);
  } catch {
    return null;
  }
}

/**
 * A formula as a picture for the canvas: a data URL of the SVG, with its size in pixels.
 * The SVG's ex units are converted at 9 px to the ex (a 18 px font), and its ink is set to the canvas's dark ink instead of `currentColor`, which an image has no text colour to inherit.
 */
export async function texToImage(tex: string, ink: string): Promise<{ dataURL: string; width: number; height: number } | null> {
  const svg = await texToSvg(tex, true);
  if (!svg) return null;
  const ex = 9;
  const width = Math.max(1, Math.round(parseFloat(/width="([\d.]+)ex"/.exec(svg)?.[1] ?? "10") * ex));
  const height = Math.max(1, Math.round(parseFloat(/height="([\d.]+)ex"/.exec(svg)?.[1] ?? "3") * ex));
  const sized = svg
    .replace(/width="[\d.]+ex"/, `width="${width}"`)
    .replace(/height="[\d.]+ex"/, `height="${height}"`)
    .replace(/currentColor/g, ink)
    // MathJax already writes the SVG namespace; a second copy of the attribute makes the file invalid XML, which Excalidraw refuses.
    .replace(/^<svg (?![^>]*xmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg" ');
  const dataURL = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(sized)))}`;
  return { dataURL, width, height };
}
