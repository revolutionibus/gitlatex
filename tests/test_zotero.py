"""The Zotero routes (/api/zotero/*) against a fake Zotero on a local port.

The fake answers like Zotero 7's local API, when enabled like the Better BibTeX
plugin's JSON-RPC endpoint, and also plays api.zotero.org for API-key requests.

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
GROUPS = [{"id": 7, "data": {"id": 7, "name": "Lab"}}]
GROUP_ITEMS = [{"key": "GGGG7777", "data": {"key": "GGGG7777", "itemType": "article", "title": "Shared paper",
                                            "date": "2020", "creators": [{"lastName": "Curie"}]}}]
GROUP_BIBTEX = "@article{curie_shared_2020,\n  title = {Shared paper},\n}\n"
WEB_KEY = "secret-key"


class FakeZotero(BaseHTTPRequestHandler):
    app_running = True
    better_bibtex = False
    local_api = True
    groups = False
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
        if url.path == "/keys/current" or url.path.startswith(("/users/", "/groups/")):
            return self._web(url.path, query)
        if not self.app_running:
            return self._send(404, "No endpoint", "text/plain")
        if url.path == "/connector/ping":
            return self._send(200, "Zotero is running", "text/plain")
        if url.path == "/better-bibtex/cayw":
            return self._send(200, "ready", "text/plain") if self.better_bibtex else self._send(404, "No endpoint")
        if url.path.startswith("/api/"):
            if not self.local_api:
                return self._send(403, "Local API is not enabled", "text/plain")
            if url.path == "/api/users/0/items/top" and query.get("format") == ["keys"]:
                return self._send(200, "AAAA1111", "text/plain")
            return self._library(url.path[len("/api"):], "/users/0", query)
        self._send(404, "No endpoint", "text/plain")

    def _web(self, path, query):
        """api.zotero.org: user 42, reachable only with WEB_KEY."""
        if self.headers.get("Zotero-API-Key") != WEB_KEY:
            return self._send(403, "Forbidden", "text/plain")
        if path == "/keys/current":
            return self._send(200, {"userID": 42, "username": "ada", "access": {"user": {"library": True}}})
        self._library(path, "/users/42", query)

    def _library(self, path, own, query):
        """The API both share: the own library, its group list, and group 7."""
        bibtex = query.get("format") in (["bibtex"], ["biblatex"])
        if path == own + "/groups" and self.groups:
            return self._send(200, GROUPS)
        if path == own + "/items/top":
            return self._send(200, ITEMS)
        if path == own + "/items" and bibtex:
            return self._send(200, BIBTEX, "text/plain")
        if path == "/groups/7/items/top":
            return self._send(200, GROUP_ITEMS)
        if path == "/groups/7/items" and bibtex:
            return self._send(200, GROUP_BIBTEX, "text/plain")
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
        cls.saved_urls = zotero.ZOTERO_URL, zotero.WEB_URL

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        zotero.ZOTERO_URL, zotero.WEB_URL = cls.saved_urls

    def setUp(self):
        zotero.ZOTERO_URL = zotero.WEB_URL = "http://127.0.0.1:%d" % self.server.server_address[1]
        zotero._web_users.clear()
        zotero._groups_cache.clear()
        FakeZotero.app_running = True
        FakeZotero.better_bibtex = False
        FakeZotero.local_api = True
        FakeZotero.groups = False
        FakeZotero.requests = []
        self.client = create_app().test_client()

    def test_local_api_search_and_export(self):
        st = self.client.get("/api/zotero/status").get_json()
        self.assertEqual(st, {"running": True, "betterBibtex": False, "localApi": True, "web": False, "username": None, "message": None})

        res = self.client.get("/api/zotero/search?q=knuth").get_json()
        self.assertEqual(res["source"], "localApi")
        self.assertEqual([i["id"] for i in res["items"]], ["user:AAAA1111"])  # the note is dropped
        self.assertEqual(res["items"][0]["creators"], ["Knuth"])
        self.assertEqual(res["items"][0]["year"], "1984")

        res = self.client.post("/api/zotero/export", json={"ids": ["user:AAAA1111"], "source": "localApi"}).get_json()
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

    def test_web_api_when_the_app_is_closed(self):
        FakeZotero.app_running = False
        key = {"X-Zotero-Key": WEB_KEY}
        st = self.client.get("/api/zotero/status", headers=key).get_json()
        self.assertFalse(st["running"])
        self.assertTrue(st["web"])
        self.assertEqual(st["username"], "ada")
        self.assertIsNone(st["message"])

        res = self.client.get("/api/zotero/search?q=knuth", headers=key).get_json()
        self.assertEqual(res["source"], "web")
        self.assertEqual([i["id"] for i in res["items"]], ["user:AAAA1111"])

        res = self.client.post("/api/zotero/export", json={"ids": ["user:AAAA1111"], "source": "web"}, headers=key).get_json()
        self.assertEqual(res["bibtex"], BIBTEX)
        self.assertEqual(FakeZotero.requests[-1][0], "/users/42/items")

    def test_group_libraries_are_searched_too(self):
        FakeZotero.groups = True
        res = self.client.get("/api/zotero/search?q=").get_json()
        self.assertEqual([(i["id"], i["library"]) for i in res["items"]],
                         [("user:AAAA1111", "My Library"), ("group/7:GGGG7777", "Lab")])

        res = self.client.post("/api/zotero/export", json={"ids": ["group/7:GGGG7777", "user:AAAA1111"], "source": "localApi"}).get_json()
        self.assertIn(GROUP_BIBTEX.strip(), res["bibtex"])
        self.assertIn(BIBTEX.strip(), res["bibtex"])
        exported = sorted(path for path, query in FakeZotero.requests if isinstance(query, dict) and query.get("itemKey"))
        self.assertEqual(exported, ["/api/groups/7/items", "/api/users/0/items"])

    def test_group_libraries_on_zotero_org(self):
        FakeZotero.app_running = False
        FakeZotero.groups = True
        key = {"X-Zotero-Key": WEB_KEY}
        res = self.client.get("/api/zotero/search?q=", headers=key).get_json()
        self.assertEqual(res["source"], "web")
        self.assertEqual([i["id"] for i in res["items"]], ["user:AAAA1111", "group/7:GGGG7777"])
        res = self.client.post("/api/zotero/export", json={"ids": ["group/7:GGGG7777"], "source": "web"}, headers=key).get_json()
        self.assertEqual(res["bibtex"], GROUP_BIBTEX)
        self.assertEqual(FakeZotero.requests[-1][0], "/groups/7/items")

    def test_a_failing_group_is_left_out(self):
        FakeZotero.groups = True
        GROUPS.append({"id": 99, "data": {"id": 99, "name": "Gone"}})  # the fake has no group 99
        try:
            res = self.client.get("/api/zotero/search?q=").get_json()
        finally:
            GROUPS.pop()
        self.assertEqual([i["library"] for i in res["items"]], ["My Library", "Lab"])

    def test_export_rejects_malformed_ids(self):
        res = self.client.post("/api/zotero/export", json={"ids": ["../../etc:X"], "source": "localApi"})
        self.assertEqual(res.status_code, 502)

    def test_the_app_wins_over_the_web_api(self):
        res = self.client.get("/api/zotero/search?q=knuth", headers={"X-Zotero-Key": WEB_KEY}).get_json()
        self.assertEqual(res["source"], "localApi")

    def test_bad_web_key(self):
        FakeZotero.app_running = False
        st = self.client.get("/api/zotero/status", headers={"X-Zotero-Key": "wrong"}).get_json()
        self.assertFalse(st["web"])
        self.assertIn("did not accept the API key", st["message"])
        res = self.client.get("/api/zotero/search?q=x", headers={"X-Zotero-Key": "wrong"})
        self.assertEqual(res.status_code, 502)

    def test_web_export_needs_a_key(self):
        res = self.client.post("/api/zotero/export", json={"ids": ["user:AAAA1111"], "source": "web"})
        self.assertEqual(res.status_code, 502)
        self.assertIn("API key", res.get_json()["error"])

    def test_export_needs_items(self):
        res = self.client.post("/api/zotero/export", json={"ids": [], "source": "localApi"})
        self.assertEqual(res.status_code, 502)


if __name__ == "__main__":
    unittest.main()
