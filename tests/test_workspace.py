"""The editor's file API (/api/project/*): build output is ignored, hidden and cleanable.

    python -m unittest discover tests
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gitlatex.app import create_app  # noqa: E402


def write(path, text=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


class BuildFilesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repos = os.path.join(self._tmp.name, "repos")
        self.client = create_app(self.repos).test_client()
        res = self.client.post("/api/project/create", json={"name": "paper", "files": [{"path": "main.tex", "text": "x"}]})
        self.assertEqual(res.status_code, 200, res.get_json())
        self.root = os.path.join(self.repos, "paper")

    def tearDown(self):
        self._tmp.cleanup()

    def test_new_project_ignores_build_output(self):
        with open(os.path.join(self.root, ".gitignore"), encoding="utf-8") as f:
            ignore = f.read().splitlines()
        self.assertIn("*.aux", ignore)
        self.assertIn("*.synctex.gz", ignore)
        self.assertNotIn("*.pdf", ignore)

    def test_existing_gitignore_is_kept(self):
        res = self.client.post("/api/project/create", json={"name": "other", "files": [{"path": ".gitignore", "text": "mine\n"}]})
        self.assertEqual(res.status_code, 200, res.get_json())
        with open(os.path.join(self.repos, "other", ".gitignore"), encoding="utf-8") as f:
            self.assertEqual(f.read(), "mine\n")

    def test_open_hides_build_output(self):
        for name in ("main.aux", "main.log", "main.synctex.gz", "main.pdf"):
            write(os.path.join(self.root, name))
        files = self.client.post("/api/project/open", json={"name": "paper"}).get_json()["files"]
        paths = {f["path"] for f in files}
        self.assertNotIn("main.aux", paths)
        self.assertNotIn("main.log", paths)
        self.assertNotIn("main.synctex.gz", paths)
        self.assertIn("main.pdf", paths)

    def test_clean_removes_only_output_of_a_tex(self):
        for name in ("main.aux", "main.log", "main.synctex.gz", "main.run.xml", "main.pdf", "notes.log", "chapters/one.tex", "chapters/one.aux"):
            write(os.path.join(self.root, name))
        self.client.post("/api/project/open", json={"name": "paper"})
        res = self.client.post("/api/project/clean")
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertEqual(res.get_json()["removed"], ["chapters/one.aux", "main.aux", "main.log", "main.run.xml", "main.synctex.gz"])
        left = sorted(os.listdir(self.root))
        self.assertIn("main.pdf", left)
        self.assertIn("notes.log", left)
        self.assertIn("main.tex", left)


if __name__ == "__main__":
    unittest.main()
