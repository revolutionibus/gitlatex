"""Local builds (run_latex_build): passes, bibliography runs and XeLaTeX, with a
fake engine that writes the files a real one would.

    python -m unittest discover tests
"""

import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gitlatex.services import latex  # noqa: E402


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


class FakeTeX:
    """Stands in for the TeX tools: `aux(n)` is the .aux the engine writes on its
    n-th pass of a build; `log` the .log it writes."""

    def __init__(self, root, aux, log="", engine_code=0, bib_code=0, bib_out=""):
        self.root, self.aux, self.log = root, aux, log
        self.engine_code, self.bib_code, self.bib_out = engine_code, bib_code, bib_out
        self.calls = []
        self.passes = 0

    def run(self, cmd, cwd, timeout=180):
        tool = cmd[0]
        self.calls.append(tool)
        if tool in latex.LATEX_ENGINES:
            self.passes += 1
            write(os.path.join(cwd, "main.aux"), self.aux(self.passes))
            write(os.path.join(cwd, "main.log"), self.log)
            write(os.path.join(cwd, "main.xdv" if "-no-pdf" in cmd else "main.pdf"), "out")
            return self.engine_code, ""
        if tool in ("bibtex", "biber"):
            write(os.path.join(cwd, "main.bbl"), "\\begin{thebibliography}{1}\\end{thebibliography}")
            return self.bib_code, self.bib_out
        if tool == "xdvipdfmx":
            write(os.path.join(cwd, "main.pdf"), "pdf")
            return 0, ""
        raise FileNotFoundError(tool)

    def build(self, engine="pdflatex", tools=("bibtex", "biber", "xdvipdfmx")):
        self.passes = 0
        self.calls = []
        which = lambda name: ("/usr/bin/" + name) if name in tools else None
        with mock.patch.object(latex, "_run_tool", self.run), mock.patch.object(latex.shutil, "which", which):
            return latex.run_latex_build(self.root, "main.tex", engine)


class BuildTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        write(os.path.join(self.root, "main.tex"), "x")
        latex._bib_runs.clear()

    def tearDown(self):
        self._tmp.cleanup()

    def test_editing_text_takes_one_pass(self):
        tex = FakeTeX(self.root, lambda n: "\\relax\n\\newlabel{a}{{1}{1}}\n")
        tex.build()  # the first build makes the .aux
        tex.build()
        self.assertEqual(tex.calls, ["pdflatex"])

    def test_a_new_label_reruns_until_it_settles(self):
        tex = FakeTeX(self.root, lambda n: "\\newlabel{a}{{1}{1}}\n")
        tex.build()
        tex.aux = lambda n: "\\newlabel{a}{{1}{1}}\n\\newlabel{b}{{2}{%d}}\n" % min(n, 2)
        tex.build()
        self.assertEqual(tex.calls, ["pdflatex", "pdflatex", "pdflatex"])

    def test_a_rerun_request_alone_gives_one_more_pass_not_a_loop(self):
        tex = FakeTeX(self.root, lambda n: "\\relax\n", log="Package rerunfilecheck Warning: File `main.loa' has changed. Rerun to get it right.")
        tex.build()
        tex.build()
        self.assertEqual(tex.calls, ["pdflatex", "pdflatex"])

    def test_bibtex_runs_only_when_what_it_reads_changes(self):
        write(os.path.join(self.root, "refs.bib"), "@book{knuth, title={TeX}}")
        aux = "\\citation{knuth}\n\\bibdata{refs}\n\\bibstyle{plain}\n"
        tex = FakeTeX(self.root, lambda n: aux)
        tex.build()
        self.assertIn("bibtex", tex.calls)
        tex.build()
        self.assertNotIn("bibtex", tex.calls)
        write(os.path.join(self.root, "refs.bib"), "@book{knuth, title={The TeXbook}}")
        tex.build()
        self.assertIn("bibtex", tex.calls)

    def test_a_citation_in_an_included_chapter_reruns_bibtex(self):
        write(os.path.join(self.root, "refs.bib"), "@book{knuth, title={TeX}}")
        write(os.path.join(self.root, "chapters", "intro.aux"), "\\relax\n")
        aux = "\\bibdata{refs}\n\\bibstyle{plain}\n\\@input{chapters/intro.aux}\n"
        tex = FakeTeX(self.root, lambda n: aux)
        tex.build()
        tex.build()
        self.assertNotIn("bibtex", tex.calls)
        # \include{chapters/intro} gained a \cite: its citation is in the chapter's .aux.
        write(os.path.join(self.root, "chapters", "intro.aux"), "\\relax\n\\citation{knuth}\n")
        tex.build()
        self.assertIn("bibtex", tex.calls)

    def test_a_failing_bibliography_tool_is_reported_not_rerun(self):
        write(os.path.join(self.root, "main.bcf"), "<bcf:datasource type=\"file\">refs.bib</bcf:datasource>")
        tex = FakeTeX(self.root, lambda n: "\\relax\n", bib_code=2, bib_out="ERROR - Error: Found biblatex control file version 3.10, expected 3.11")
        first = tex.build()
        self.assertIn("biber", tex.calls)
        self.assertIn("control file version", next(s for s in first["steps"] if s["tool"] == "biber")["message"])
        second = tex.build()
        self.assertNotIn("biber", tex.calls)
        self.assertIn("control file version", next(s for s in second["steps"] if s["tool"] == "biber")["message"])

    def test_xelatex_makes_the_pdf_once_from_the_xdv(self):
        # A first build: the .aux appears on pass 1, pass 2 confirms it.
        tex = FakeTeX(self.root, lambda n: "\\newlabel{a}{{1}{1}}\n")
        result = tex.build("xelatex")
        self.assertEqual(tex.calls, ["xelatex", "xelatex", "xdvipdfmx"])
        self.assertIsNone(result["error"])

    def test_xelatex_errors_are_not_hidden_by_the_pdf_step(self):
        tex = FakeTeX(self.root, lambda n: "\\relax\n", log="./main.tex:3: Undefined control sequence.\nl.3 \\foo\n", engine_code=1)
        result = tex.build("xelatex")
        self.assertEqual(tex.calls[-1], "xdvipdfmx")
        self.assertIsNotNone(result["error"])
        self.assertIn("Undefined control sequence", result["error"])

    def test_without_xdvipdfmx_xelatex_writes_the_pdf_itself(self):
        tex = FakeTeX(self.root, lambda n: "\\relax\n")
        tex.build("xelatex", tools=())
        self.assertNotIn("xdvipdfmx", tex.calls)


if __name__ == "__main__":
    unittest.main()
