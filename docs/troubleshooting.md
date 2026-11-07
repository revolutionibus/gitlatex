# Troubleshooting

| Problem | Fix |
| --- | --- |
| Compile fails immediately | With **Local TeX**, make sure `pdflatex` is on your `PATH`, or switch **Settings → Compiler** to **Auto** or **In the browser**. |
| The first browser compile is slow | It downloads the TeX engine (~190 MB) once. Run `gitlatex --fetch-engine` to do it ahead of time. |
| Citations show as `??` | Locally, install `biber` (for `biblatex`) or `bibtex`. In the browser there is no biber: use `\usepackage[backend=bibtex]{biblatex}`. |
| The Zotero tab can't connect | Open the Zotero app and turn on its local API (or install Better BibTeX), or add a zotero.org API key in **Settings → Zotero**. See [citations.md](citations.md#if-the-zotero-tab-says-it-cant-connect). |
| A link to a figure shows only the caption | Use the built-in PDF viewer, or add `\usepackage{caption}` to the document. See [pdf-viewer.md](pdf-viewer.md#links). |
| Port already in use | Run on another port: `gitlatex --port 3000`. |
| Show in PDF / double-click says "No SyncTeX data" | Compile first. With a Compiler API, the API must return `synctex` alongside the PDF — see **Settings → Compiler API**. |
| Comments are signed "Anonymous" | Set your git identity: `git config --global user.name "Your Name"`. |
| Spell check unavailable | `pip install symspellpy` — it ships as a dependency, but a partial install can miss it. |
| Windows: "The process cannot access the file… gitlatex.exe" | Another instance is running. Close it and try again. |
| Windows: a project will not delete | A file in it is open elsewhere. Close any Explorer window or terminal sitting in that folder. |
