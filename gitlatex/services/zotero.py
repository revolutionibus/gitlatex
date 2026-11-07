"""Talking to Zotero: the desktop app on this machine, or the zotero.org cloud.

The app listens on localhost:23119. Three ways in, best first:

    Better BibTeX   the popular plugin; its JSON-RPC endpoint searches the
                    library and exports with the user's stable citation keys.
    local API       built into Zotero 7 (Settings > Advanced > "Allow other
                    applications on this computer to communicate with
                    Zotero"); a read-only mirror of the Zotero web API.
    web API         api.zotero.org, with an API key from
                    zotero.org/settings/keys. Works without the app running,
                    for the library as last synced.

The local and web APIs speak the same protocol, so they share the search and
export code below; only the address and the key differ.

Requests go through the gitlatex server rather than the browser because the
app refuses cross-origin requests from web pages. The API key comes from the
editor with each request and is only ever sent to api.zotero.org.
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ZOTERO_URL = os.environ.get("GITLATEX_ZOTERO_URL", "http://127.0.0.1:23119").rstrip("/")
WEB_URL = os.environ.get("GITLATEX_ZOTERO_WEB_URL", "https://api.zotero.org").rstrip("/")
SEARCH_LIMIT = 50
_SKIP_TYPES = frozenset({"attachment", "note", "annotation"})

NOT_RUNNING = "Zotero is not running. Open the Zotero app and try again."
NO_LOCAL_API = ('Zotero is running but does not accept requests from other apps. In Zotero, open '
                'Settings > Advanced and turn on "Allow other applications on this computer to '
                'communicate with Zotero", or install the Better BibTeX plugin.')


class ZoteroError(Exception):
    """A failure worth showing the user as is."""


def _request(path, data=None, timeout=5.0, key=None):
    """GET (or POST `data` as JSON) to the app, or with `key` to api.zotero.org."""
    headers = {"User-Agent": "gitlatex", "Zotero-API-Version": "3"}
    if key:
        headers["Zotero-API-Key"] = key
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request((WEB_URL if key else ZOTERO_URL) + path, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError):
        raise ZoteroError("Could not reach zotero.org. Check your internet connection." if key else NOT_RUNNING)


def _has_better_bibtex():
    try:
        status, text = _request("/better-bibtex/cayw?probe=true", timeout=2.0)
    except ZoteroError:
        return False
    return status == 200 and text.strip() == "ready"


# ---- zotero.org ---------------------------------------------------------------------

_web_users = {}


def web_account(key):
    """{userID, username} for an API key; raises ZoteroError when zotero.org refuses it."""
    if key in _web_users:
        return _web_users[key]
    code, text = _request("/keys/current", timeout=10.0, key=key)
    if code in (403, 404):
        raise ZoteroError("zotero.org did not accept the API key. Check it in Settings > Zotero.")
    if code != 200:
        raise ZoteroError("zotero.org answered HTTP %d" % code)
    reply = json.loads(text)
    if not (reply.get("access") or {}).get("user", {}).get("library"):
        raise ZoteroError("This API key cannot read your library. On zotero.org, edit the key and "
                          'tick "Allow library access".')
    account = {"userID": reply.get("userID"), "username": reply.get("username") or ""}
    _web_users[key] = account
    return account


def status(key=None):
    """Which ways in are available: {running, betterBibtex, localApi, web, username, message}."""
    out = {"running": False, "betterBibtex": False, "localApi": False, "web": False, "username": None, "message": None}
    try:
        out["running"] = _request("/connector/ping", timeout=2.0)[0] == 200
    except ZoteroError:
        pass
    if out["running"]:
        out["betterBibtex"] = _has_better_bibtex()
        code, _ = _request("/api/users/0/items/top?limit=1&format=keys", timeout=3.0)
        out["localApi"] = code == 200
    web_error = None
    if key:
        try:
            out["username"] = web_account(key)["username"]
            out["web"] = True
        except ZoteroError as e:
            web_error = str(e)
    if not (out["betterBibtex"] or out["localApi"] or out["web"]):
        out["message"] = web_error or (NO_LOCAL_API if out["running"] else NOT_RUNNING)
    return out


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


# ---- Zotero API: the app's local mirror (/api/...) or zotero.org (with a key) ------
#
# A library is a scope: "user" (the person's own library) or "group/<id>". Items
# are identified as "<scope>:<item key>", so export() knows where to fetch them.

_ITEM_ID = re.compile(r"^(user|group/\d+):([A-Za-z0-9]+)$")
GROUPS_TTL = 60.0
_groups_cache = {}


def _prefix(scope, key=None):
    if scope == "user":
        return "/users/%s" % web_account(key)["userID"] if key else "/api/users/0"
    return ("" if key else "/api") + "/groups/" + scope.split("/", 1)[1]


def _libraries(key=None):
    """[(scope, name)]: the person's own library, then every group library they belong to.

    The group list is cached for a minute so typing in the search box does not
    re-fetch it. A failure only means no groups: the own library still works.
    """
    hit = _groups_cache.get(key)
    if hit and time.monotonic() - hit[0] < GROUPS_TTL:
        return hit[1]
    libraries = [("user", "My Library")]
    try:
        code, text = _request(_prefix("user", key) + "/groups?format=json&limit=100", timeout=10.0, key=key)
        if code == 200:
            for g in json.loads(text):
                data = g.get("data") or {}
                gid = g.get("id") or data.get("id")
                if gid:
                    libraries.append(("group/%d" % int(gid), data.get("name") or "Group %s" % gid))
    except (ZoteroError, ValueError, TypeError, AttributeError):
        pass
    _groups_cache[key] = (time.monotonic(), libraries)
    return libraries


def _api_search(scope, library, query, key=None):
    params = urllib.parse.urlencode({
        "q": query, "qmode": "titleCreatorYear", "limit": SEARCH_LIMIT,
        "format": "json", "sort": "dateModified", "direction": "desc",
    })
    code, text = _request(_prefix(scope, key) + "/items/top?" + params, timeout=10.0, key=key)
    if code == 403:
        raise ZoteroError("zotero.org refused the search. Check the API key in Settings > Zotero." if key else NO_LOCAL_API)
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
            "id": "%s:%s" % (scope, it.get("key") or data.get("key")),
            # Zotero 7 has a native citation key field; usually empty without Better BibTeX.
            "key": data.get("citationKey") or None,
            "title": data.get("title") or "",
            "creators": [c for c in creators if c],
            "year": year.group(0) if year else "",
            "type": data.get("itemType") or "",
            "where": data.get("publicationTitle") or data.get("proceedingsTitle") or data.get("publisher") or "",
            "library": library,
        })
    return items


def _api_search_all(query, key=None):
    """Search every library at once; the own library's results come first.

    If the own library cannot be searched the source is unusable and that error
    is raised; a group that fails is left out.
    """
    libraries = _libraries(key)
    with ThreadPoolExecutor(max_workers=min(8, len(libraries))) as pool:
        futures = [pool.submit(_api_search, scope, name, query, key) for scope, name in libraries]
    items = []
    for (scope, _), future in zip(libraries, futures):
        try:
            items.extend(future.result())
        except ZoteroError:
            if scope == "user":
                raise
    return items


def _api_export(ids, biblatex, key=None):
    """BibTeX for "<scope>:<item key>" ids, fetched library by library."""
    by_scope = {}
    for item_id in ids:
        m = _ITEM_ID.match(item_id)
        if not m:
            raise ZoteroError("Unknown Zotero item: %s" % item_id)
        by_scope.setdefault(m.group(1), []).append(m.group(2))
    parts = []
    for scope, item_keys in by_scope.items():
        params = urllib.parse.urlencode({"itemKey": ",".join(item_keys), "format": "biblatex" if biblatex else "bibtex"})
        code, text = _request(_prefix(scope, key) + "/items?" + params, timeout=15.0, key=key)
        if code != 200:
            raise ZoteroError("Zotero export failed (HTTP %d)" % code)
        parts.append(text.strip())
    return "\n\n".join(p for p in parts if p)


# ---- the routes' entry points --------------------------------------------------------

def search(query, key=None):
    """Items matching `query`; each has an `id` to pass to export() with the returned source.

    The app is asked first (Better BibTeX, then its local API); with an API key,
    zotero.org answers when the app cannot. The local and web APIs search the
    person's own library and their group libraries.
    """
    query = (query or "").strip()
    if _has_better_bibtex():
        return {"source": "betterBibtex", "items": _bbt_search(query) if query else []}
    try:
        return {"source": "localApi", "items": _api_search_all(query)}
    except ZoteroError:
        if not key:
            raise
    return {"source": "web", "items": _api_search_all(query, key)}


def export(ids, source, biblatex=False, key=None):
    """BibTeX (or BibLaTeX) for items returned by search() from `source`."""
    ids = [str(i) for i in ids or [] if i]
    if not ids:
        raise ZoteroError("No items selected")
    if source == "betterBibtex":
        text = _bbt_export(ids, biblatex)
    elif source == "web":
        if not key:
            raise ZoteroError("Add your zotero.org API key in Settings > Zotero")
        text = _api_export(ids, biblatex, key)
    else:
        text = _api_export(ids, biblatex)
    text = text.strip()
    if not text.startswith("@"):
        raise ZoteroError("Zotero returned no BibTeX for the selected items")
    return text + "\n"
