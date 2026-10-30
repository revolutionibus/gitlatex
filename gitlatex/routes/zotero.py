"""Searching the user's Zotero library and exporting items as BibTeX.

The editor sends the zotero.org API key, when one is set, in the
X-Zotero-Key header (never in the URL, so it stays out of logs).
"""

from flask import Blueprint, jsonify, request

from gitlatex.http import _json
from gitlatex.services import zotero

bp = Blueprint("zotero", __name__)


def _key():
    return (request.headers.get("X-Zotero-Key") or "").strip() or None


@bp.route("/api/zotero/status")
def zotero_status():
    return jsonify(zotero.status(_key()))


@bp.route("/api/zotero/search")
def zotero_search():
    try:
        return jsonify(zotero.search(request.args.get("q", ""), _key()))
    except zotero.ZoteroError as e:
        return jsonify(error=str(e)), 502


@bp.route("/api/zotero/export", methods=["POST"])
def zotero_export():
    """BibTeX for the chosen items. The editor merges it into the project's .bib file."""
    data = _json()
    try:
        return jsonify(bibtex=zotero.export(data.get("ids"), data.get("source"), bool(data.get("biblatex")), _key()))
    except zotero.ZoteroError as e:
        return jsonify(error=str(e)), 502
