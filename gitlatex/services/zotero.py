"""Talking to the Zotero desktop app on this machine.

Zotero listens on localhost:23119. Two ways in, best first:

    Better BibTeX   the popular plugin; its JSON-RPC endpoint searches the
                    library and exports with the user's stable citation keys.
    local API       built into Zotero 7 (Settings > Advanced > "Allow other
                    applications on this computer to communicate with
                    Zotero"); a read-only mirror of the Zotero web API.

Requests go through the gitlatex server rather than the browser because Zotero
refuses cross-origin requests from web pages. Nothing here leaves the machine.
"""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

ZOTERO_URL = os.environ.get("GITLATEX_ZOTERO_URL", "http://127.0.0.1:23119").rstrip("/")
SEARCH_LIMIT = 50
_SKIP_TYPES = frozenset({"attachment", "note", "annotation"})


class ZoteroError(Exception):
    """A failure worth showing the user as is."""


def _request(path, data=None, timeout=5.0):
    headers = {"User-Agent": "gitlatex", "Zotero-API-Version": "3"}
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(ZOTERO_URL + path, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError):
        raise ZoteroError("Zotero is not running. Open the Zotero app and try again.")


def _has_better_bibtex():
    try:
        status, text = _request("/better-bibtex/cayw?probe=true", timeout=2.0)
    except ZoteroError:
        return False
    return status == 200 and text.strip() == "ready"


def status():
    """Which way in is available: {running, betterBibtex, localApi, message}."""
    try:
        _request("/connector/ping", timeout=2.0)
    except ZoteroError as e:
        return {"running": False, "betterBibtex": False, "localApi": False, "message": str(e)}
    bbt = _has_better_bibtex()
    code, _ = _request("/api/users/0/items/top?limit=1&format=keys", timeout=3.0)
    local = code == 200
    message = None
    if not bbt and not local:
        message = ('Zotero is running but does not accept requests from other apps. In Zotero, open '
                   'Settings > Advanced and turn on "Allow other applications on this computer to '
                   'communicate with Zotero", or install the Better BibTeX plugin.')
    return {"running": True, "betterBibtex": bbt, "localApi": local, "message": message}


# ---- Better BibTeX ------------------------------------------------------------------

def _rpc(method, *params):
    status_code, text = _request("/better-bibtex/json-rpc", {"jsonrpc": "2.0", "method": method, "params": list(params)},
                                 timeout=15.0)
    try:
        reply = json.loads(text)
    except ValueError:
        raise ZoteroError("Better BibTeX returned an unexpected response (HTTP %d)" % status_code)
    if reply.get("error"):
        raise ZoteroError("Better BibTeX: " + str(reply["error"].get("message") or reply["error"]))
    return reply.get("result")


def _csl_names(names):
    out = []
    for n in names or []:
        out.append(n.get("family") or n.get("literal") or n.get("given") or "")
    return [n for n in out if n]


def _csl_year(item):
    parts = ((item.get("issued") or {}).get("date-parts") or [[None]])[0]
    if parts and parts[0]:
        return str(parts[0])
    m = re.search(r"\d{4}", str((item.get("issued") or {}).get("raw") or ""))
    return m.group(0) if m else ""


def _bbt_search(query):
    results = _rpc("item.search", query) or []
    items = []
    for it in results:
        key = it.get("citekey") or it.get("citationKey") or it.get("citation-key")
        if not key:
            continue
        items.append({
            "id": key,
            "key": key,
            "title": it.get("title") or "",
            "creators": _csl_names(it.get("author") or it.get("editor")),
            "year": _csl_year(it),
            "type": it.get("type") or "",
            "where": it.get("container-title") or it.get("publisher") or "",
        })
    return items[:SEARCH_LIMIT]


def _bbt_export(citekeys, biblatex):
    result = _rpc("item.export", citekeys, "Better BibLaTeX" if biblatex else "Better BibTeX")
    # Older Better BibTeX releases answer [status, content type, body].
    if isinstance(result, list):
        result = result[-1] if result else ""
    return result or ""


# ---- Zotero local API ---------------------------------------------------------------

def _local_search(query):
    params = urllib.parse.urlencode({
        "q": query, "qmode": "titleCreatorYear", "limit": SEARCH_LIMIT,
        "format": "json", "sort": "dateModified", "direction": "desc",
    })
    code, text = _request("/api/users/0/items/top?" + params, timeout=10.0)
    if code == 403:
        raise ZoteroError(status()["message"] or "Zotero refused the request.")
    if code != 200:
        raise ZoteroError("Zotero search failed (HTTP %d)" % code)
    items = []
    for it in json.loads(text):
        data = it.get("data") or {}
        if data.get("itemType") in _SKIP_TYPES:
            continue
        creators = [c.get("lastName") or c.get("name") or "" for c in data.get("creators") or []]
        year = re.search(r"\d{4}", data.get("date") or "")
        items.append({
            "id": it.get("key") or data.get("key"),
            # Zotero 7 has a native citation key field; usually empty without Better BibTeX.
            "key": data.get("citationKey") or None,
            "title": data.get("title") or "",
            "creators": [c for c in creators if c],
            "year": year.group(0) if year else "",
            "type": data.get("itemType") or "",
            "where": data.get("publicationTitle") or data.get("proceedingsTitle") or data.get("publisher") or "",
        })
    return items


def _local_export(item_keys, biblatex):
    params = urllib.parse.urlencode({"itemKey": ",".join(item_keys), "format": "biblatex" if biblatex else "bibtex"})
    code, text = _request("/api/users/0/items?" + params, timeout=15.0)
    if code != 200:
        raise ZoteroError("Zotero export failed (HTTP %d)" % code)
    return text


# ---- the routes' entry points --------------------------------------------------------

def search(query):
    """Items matching `query`; each has an `id` to pass to export()."""
    query = (query or "").strip()
    if _has_better_bibtex():
        return {"source": "betterBibtex", "items": _bbt_search(query) if query else []}
    return {"source": "localApi", "items": _local_search(query)}


def export(ids, source, biblatex=False):
    """BibTeX (or BibLaTeX) for items returned by search() from `source`."""
    ids = [str(i) for i in ids or [] if i]
    if not ids:
        raise ZoteroError("No items selected")
    text = _bbt_export(ids, biblatex) if source == "betterBibtex" else _local_export(ids, biblatex)
    text = text.strip()
    if not text.startswith("@"):
        raise ZoteroError("Zotero returned no BibTeX for the selected items")
    return text + "\n"
