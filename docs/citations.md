# Citations and Zotero

## Inserting a citation

Open the **Insert citation** picker in any of these ways:

- `Ctrl`+`Shift`+`C` (`Cmd`+`Shift`+`C` on macOS) in a `.tex` file
- right-click in the editor → **Insert citation…**
- type `/cite` on an empty line and pick **Citation**
- inside `\cite{…}`, press `Ctrl`+`Space` and choose **Search Zotero…**, the last
  suggestion

The picker has two tabs:

- **This project** lists the entries in your `.bib` files. Search by key, title,
  author or year, tick the ones you want, and click **Cite**. You can also
  paste a DOI and click **Import** to add its BibTeX entry.
- **Zotero** searches your Zotero library (see below).

The picker remembers the tab you used last.

**The citation command** follows your document: `\autocite` and friends with
`biblatex`, `\citep`/`\citet` with `natbib`, otherwise `\cite`. Pick another
from the menu at the bottom. When the cursor is already inside a `\cite{…}`,
the chosen keys are added to it instead of starting a new citation.

**Imported entries** go into the project's first `.bib` file, or a new
`references.bib` when there is none. An entry whose key is already there is not
added twice. If the document has no `\bibliography` or `\addbibresource` yet,
you are reminded to add one.

## Zotero

Search your Zotero library, tick items, and click **Import & cite**: their
BibTeX (BibLaTeX when the document uses `biblatex`) is added to your `.bib`
file and the citation is inserted.

Your **personal library and every group library** you belong to are searched
together. When results come from more than one library, each shows which.

GitLaTeX reaches Zotero in one of three ways, and uses the first that works:

| Way | Set up | Notes |
| --- | --- | --- |
| **Better BibTeX** | Install the [Better BibTeX](https://retorque.re/zotero-better-bibtex/) plugin in the Zotero app | Best: your stable Better BibTeX citation keys. |
| **Zotero's local API** | Zotero 7: **Settings → Advanced →** *Allow other applications on this computer to communicate with Zotero* | Built in, nothing to install. |
| **zotero.org** | Add an API key in GitLaTeX's **Settings → Zotero** | Works when the Zotero app is closed or not installed, for your library as last synced. |

The first two need the Zotero desktop app open on the same computer. Nothing
leaves your machine; GitLaTeX's server talks to Zotero on your behalf, because
Zotero refuses requests straight from web pages.

### Using a zotero.org API key

1. On zotero.org, open [Settings → Security → Create new private key](https://www.zotero.org/settings/keys/new).
2. Tick **Allow library access**. For group libraries, also give the key read
   access to your groups.
3. In GitLaTeX, open **Settings → Zotero**, paste the key, and click **Check**.
   It should say *Connected as* your username.

The key is stored in this browser only. GitLaTeX sends it to its own server in
a request header (never in a URL), and the server passes it only to
api.zotero.org. The Settings page also shows whether the Zotero app was found.

### If the Zotero tab says it can't connect

- *Zotero is not running*: open the Zotero app, or add a zotero.org API key.
- *Does not accept requests from other apps*: turn on the local API setting
  above, or install Better BibTeX.
- *Did not accept the API key*: check the key in **Settings → Zotero**, and that
  it has library access.

Click **Try again** once it's fixed, or **Zotero settings** to go straight to
the key.
