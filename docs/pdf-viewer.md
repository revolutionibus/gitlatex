# The PDF viewer

The built-in viewer (pdf.js) shows each build beside the editor. Rebuilds swap
in without a blank flash, and the view stays where you were unless the build
opens your cursor's page ([pdf-cursor-sync.md](pdf-cursor-sync.md)).

Everything below needs the built-in viewer. The browser's own PDF viewer
(**Settings → PDF viewer**) shows the PDF but has none of these features.

## Links

Links in the PDF are clickable: the table of contents, `\ref`, `\eqref`,
`\cite` and other cross-references (with `hyperref` loaded), and web URLs, which
open in a new tab.

- **A link lands with some room above its target**, so a heading or equation is
  not flush with the top edge.
- **A link to a figure shows the whole figure.** With plain `hyperref`, a
  `\ref` to a figure points at its caption, so most viewers show the caption
  with the figure cut off above it. GitLaTeX notices the image or embedded
  graphic right above the target and shows it, caption below. (Figures drawn
  directly in TikZ aren't detected; their links land at the caption.)

  To fix this inside the PDF itself, for every viewer, load the `caption`
  package: `\usepackage{caption}`. The *thesis*, *paper*, *homework* and
  *welcome* templates already do.

## Back

Following a link, or jumping with **Show in PDF**, remembers where you were. A
**Back to page N** button appears at the bottom left; click it or press `B` to
return. Press it again to step further back.

## Bookmarks

Save spots in the PDF to come back to.

- **Add one:** select text and press `M`, or click the **Bookmark** button that
  appears under the selection. With nothing selected, `M` bookmarks the first
  line at the top of the view.
- **Bookmarked text stays highlighted** until you delete the bookmark.
- **Step through them:** `Shift`+`C` goes to the next bookmark, `C` to the
  previous one, wrapping around at the ends.
- **The list:** the bookmark button at the bottom left (with the count) lists
  them in page order, each with its page and text. Click one to go there (Back
  returns you), **×** deletes one, **Add** bookmarks the current spot, and
  **Clear** deletes them all.

Bookmarks are kept in this browser, per project and main file, so they survive
rebuilds and reloads. A bookmark is a position on its page, not a link to the
text: if you add text above it, it drifts by that much. If a rebuild drops a
page, its bookmarks are hidden until the page comes back.

## Keys

The keys work while the PDF has focus (click it first).

| Key | Action |
| --- | --- |
| `B` | Back to where the last link or Show in PDF jump started |
| `M` | Bookmark the selected text, or the top of the view |
| `Shift`+`C` / `C` | Next / previous bookmark |
| `Ctrl`+scroll (`Cmd`+scroll) | Zoom |
| Double-click | Jump to the source line (SyncTeX) |
