"""The Zotero routes (/api/zotero/*) against a fake Zotero on a local port.

The fake answers like Zotero 7's local API and, when enabled, like the Better
BibTeX plugin's JSON-RPC endpoint.

    python -m unittest discover tests
"""

import json
import os
import sys
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gitlatex.app import create_app  # noqa: E402
from gitlatex.services import zotero  # noqa: E402

ITEMS = [
    {"key": "AAAA1111", "data": {"key": "AAAA1111", "itemType": "book", "title": "The TeXbook", "date": "1984",
                                 "creators": [{"lastName": "Knuth"}], "publisher": "Addison-Wesley"}},
    {"key": "NOTE0000", "data": {"key": "NOTE0000", "itemType": "note", "note": "hi"}},
]
BIBTEX = "@book{knuth_texbook_1984,\n  title = {The {TeXbook}},\n}\n"


class FakeZotero(BaseHTTPRequestHandler):
    better_bibtex = False
    local_api = True
    requests = []

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        FakeZotero.requests.append((url.path, query))
        if url.path == "/connector/ping":
            return self._send(200, "Zotero is running", "text/plain")
        if url.path == "/better-bibtex/cayw":
            return self._send(200, "ready", "text/plain") if self.better_bibtex else self._send(404, "No endpoint")
        if url.path.startswith("/api/"):
            if not self.local_api:
                return self._send(403, "Local API is not enabled", "text/plain")
            if url.path == "/api/users/0/items/top":
                return self._send(200, "AAAA1111" if query.get("format") == ["keys"] else ITEMS)
            if url.path == "/api/users/0/items" and query.get("format") in (["bibtex"], ["biblatex"]):
                return self._send(200, BIBTEX, "text/plain")
        self._send(404, "No endpoint", "text/plain")

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeZotero.requests.append((self.path, body))
        if self.path != "/better-bibtex/json-rpc" or not self.better_bibtex:
            return self._send(404, "No endpoint", "text/plain")
        if body["method"] == "item.search":
            result = [{"citekey": "knuth1984", "title": "The TeXbook", "type": "book",
                       "author": [{"family": "Knuth", "given": "Donald"}], "issued": {"date-parts": [[1984]]}}]
        elif body["method"] == "item.export":
            result = "@book{knuth1984,\n  title = {The {TeXbook}},\n}\n"
        else:
            return self._send(200, {"jsonrpc": "2.0", "error": {"message": "unknown method"}})
        self._send(200, {"jsonrpc": "2.0", "result": result})


class ZoteroRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeZotero)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.saved_url = zotero.ZOTERO_URL

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        zotero.ZOTERO_URL = cls.saved_url

    def setUp(self):
        zotero.ZOTERO_URL = "http://127.0.0.1:%d" % self.server.server_address[1]
        FakeZotero.better_bibtex = False
        FakeZotero.local_api = True
        FakeZotero.requests = []
        self.client = create_app().test_client()

    def test_local_api_search_and_export(self):
        st = self.client.get("/api/zotero/status").get_json()
        self.assertEqual(st, {"running": True, "betterBibtex": False, "localApi": True, "message": None})

        res = self.client.get("/api/zotero/search?q=knuth").get_json()
        self.assertEqual(res["source"], "localApi")
        self.assertEqual([i["id"] for i in res["items"]], ["AAAA1111"])  # the note is dropped
        self.assertEqual(res["items"][0]["creators"], ["Knuth"])
        self.assertEqual(res["items"][0]["year"], "1984")

        res = self.client.post("/api/zotero/export", json={"ids": ["AAAA1111"], "source": "localApi"}).get_json()
        self.assertEqual(res["bibtex"], BIBTEX)
        path, query = FakeZotero.requests[-1]
        self.assertEqual(query["itemKey"], ["AAAA1111"])
        self.assertEqual(query["format"], ["bibtex"])

    def test_better_bibtex_is_preferred(self):
        FakeZotero.better_bibtex = True
        res = self.client.get("/api/zotero/search?q=knuth").get_json()
        self.assertEqual(res["source"], "betterBibtex")
        self.assertEqual(res["items"][0]["key"], "knuth1984")
        self.assertEqual(res["items"][0]["year"], "1984")

        res = self.client.post("/api/zotero/export",
                               json={"ids": ["knuth1984"], "source": "betterBibtex", "biblatex": True}).get_json()
        self.assertTrue(res["bibtex"].startswith("@book{knuth1984,"))
        self.assertEqual(FakeZotero.requests[-1][1]["params"], [["knuth1984"], "Better BibLaTeX"])

    def test_local_api_disabled(self):
        FakeZotero.local_api = False
        st = self.client.get("/api/zotero/status").get_json()
        self.assertTrue(st["running"])
        self.assertFalse(st["localApi"])
        self.assertIn("Allow other applications", st["message"])
        res = self.client.get("/api/zotero/search?q=x")
        self.assertEqual(res.status_code, 502)
        self.assertIn("Allow other applications", res.get_json()["error"])

    def test_zotero_not_running(self):
        zotero.ZOTERO_URL = "http://127.0.0.1:9"  # nothing listens on the discard port
        st = self.client.get("/api/zotero/status").get_json()
        self.assertFalse(st["running"])
        res = self.client.get("/api/zotero/search?q=x")
        self.assertEqual(res.status_code, 502)
        self.assertIn("not running", res.get_json()["error"])

    def test_export_needs_items(self):
        res = self.client.post("/api/zotero/export", json={"ids": [], "source": "localApi"})
        self.assertEqual(res.status_code, 502)


if __name__ == "__main__":
    unittest.main()
