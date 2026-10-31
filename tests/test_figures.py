"""EPS previews for the LyX-style editor (/api/figure/preview).

    python -m unittest discover tests
"""

import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gitlatex.app import create_app  # noqa: E402
from gitlatex.services import figures  # noqa: E402


class FigurePreviewTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repos = os.path.join(self._tmp.name, "repos")
        self.client = create_app(self.repos).test_client()
        files = [{"path": "main.tex", "text": "x"}, {"path": "Figs/plot.eps", "text": "%!PS-Adobe-3.0 EPSF-3.0\n"}]
        res = self.client.post("/api/project/create", json={"name": "paper", "files": files})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.root = os.path.join(self.repos, "paper")

    def tearDown(self):
        self._tmp.cleanup()

    def test_converts_an_eps_figure_without_writing_into_the_project(self):
        with mock.patch.object(figures, "eps_to_pdf", return_value=b"%PDF-1.5 fake") as convert:
            res = self.client.post("/api/figure/preview", json={"path": "Figs/plot.eps"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "application/pdf")
        self.assertEqual(res.data, b"%PDF-1.5 fake")
        self.assertTrue(convert.call_args[0][0].endswith(os.path.join("Figs", "plot.eps")))
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "Figs"))), ["plot.eps"])

    def test_says_so_when_nothing_can_convert(self):
        with mock.patch.object(figures, "eps_to_pdf", return_value=None):
            res = self.client.post("/api/figure/preview", json={"path": "Figs/plot.eps"})
        self.assertEqual(res.status_code, 404)
        self.assertIn("converter", res.get_json()["error"])

    def test_only_eps_files_inside_the_project(self):
        for path in ("main.tex", "../outside.eps", "Figs/missing.eps"):
            res = self.client.post("/api/figure/preview", json={"path": path})
            self.assertIn(res.status_code, (400, 404), path)


if __name__ == "__main__":
    unittest.main()
