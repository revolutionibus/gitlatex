"""Searching the user's Zotero library and exporting items as BibTeX."""

from flask import Blueprint, jsonify, request

from gitlatex.http import _json
from gitlatex.services import zotero

bp = Blueprint("zotero", __name__)


@bp.route("/api/zotero/status")
def zotero_status():
    return jsonify(zotero.status())


@bp.route("/api/zotero/search")
def zotero_search():
    try:
        return jsonify(zotero.search(request.args.get("q", "")))
    except zotero.ZoteroError as e:
        return jsonify(error=str(e)), 502


@bp.route("/api/zotero/export", methods=["POST"])
def zotero_export():
    """BibTeX for the chosen items. The editor merges it into the project's .bib file."""
    data = _json()
    try:
        return jsonify(bibtex=zotero.export(data.get("ids"), data.get("source"), bool(data.get("biblatex"))))
    except zotero.ZoteroError as e:
        return jsonify(error=str(e)), 502
