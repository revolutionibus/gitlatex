"""The local LaTeX build (services/latex.py): how many passes it runs, when the
bibliography tool runs, and XeLaTeX's single PDF conversion. Runs the real TeX
engines, so each test is skipped when its engine is not installed.

    python -m unittest discover tests
"""

import os
import shutil
import tempfile
import unittest

from gitlatex.services import latex
from gitlatex.services.latex import run_latex_build

DOC = r"""\documentclass{article}
\begin{document}
\section{Intro}\label{sec:intro}
See Section~\ref{sec:intro}. %s
%s
\end{document}
"""

BIB = """@article{knuth,
  author = {Donald Knuth},
  title = {Literate Programming},
  journal = {The Computer Journal},
  year = {1984},
}
@book{lamport,
  author = {Leslie Lamport},
  title = {LaTeX: A Document Preparation System},
  publisher = {Addison-Wesley},
  year = {1994},
}
"""


def tools(result, name):
    return [s for s in result["steps"] if s["tool"] == name]


class BuildTest(unittest.TestCase):
    engine = "pdflatex"

    def setUp(self):
        if not shutil.which(self.engine):
            self.skipTest(self.engine + " is not installed")
        self.dir = tempfile.mkdtemp()
        latex._bib_inputs.clear()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, name, text):
        with open(os.path.join(self.dir, name), "w") as f:
            f.write(text)

    def build(self):
        result = run_latex_build(self.dir, "main.tex", self.engine)
        self.assertIsNone(result["error"], result["log"][-2000:])
        self.assertTrue(os.path.isfile(os.path.join(self.dir, "main.pdf")))
        return result

    def log(self):
        with open(os.path.join(self.dir, "main.log"), errors="replace") as f:
            return f.read()

    def test_first_build_settles_references(self):
        self.write("main.tex", DOC % ("Text.", ""))
        result = self.build()
        self.assertGreaterEqual(len(tools(result, self.engine)), 2)
        self.assertNotIn("undefined references", self.log())

    def test_editing_text_takes_one_pass(self):
        self.write("main.tex", DOC % ("Text.", ""))
        self.build()
        self.write("main.tex", DOC % ("Different text, same labels.", ""))
        result = self.build()
        self.assertEqual(len(tools(result, self.engine)), 1)

    def test_a_new_label_reruns(self):
        self.write("main.tex", DOC % ("Text.", ""))
        self.build()
        self.write("main.tex", DOC % ("See also Section~\\ref{sec:more}.", "\\section{More}\\label{sec:more}"))
        result = self.build()
        self.assertGreaterEqual(len(tools(result, self.engine)), 2)
        self.assertNotIn("undefined references", self.log())

    def test_bibtex_runs_only_when_its_inputs_change(self):
        if not shutil.which("bibtex"):
            self.skipTest("bibtex is not installed")
        self.write("refs.bib", BIB)
        cite = "\\bibliographystyle{plain}\\bibliography{refs}"
        self.write("main.tex", DOC % ("\\cite{knuth}", cite))
        self.assertEqual(len(tools(self.build(), "bibtex")), 1)
        self.assertNotIn("Citation `knuth' on page 1 undefined", self.log())

        # same citations: no bibtex, one pass
        self.write("main.tex", DOC % ("\\cite{knuth} again.", cite))
        result = self.build()
        self.assertEqual(tools(result, "bibtex"), [])
        self.assertEqual(len(tools(result, self.engine)), 1)

        # a new citation: bibtex again, and the reference resolves
        self.write("main.tex", DOC % ("\\cite{knuth} and \\cite{lamport}.", cite))
        self.assertEqual(len(tools(self.build(), "bibtex")), 1)
        self.assertNotIn("Citation `lamport'", self.log())

        # an edited .bib: bibtex again
        self.write("refs.bib", BIB.replace("1984", "1983"))
        self.assertEqual(len(tools(self.build(), "bibtex")), 1)

    def test_a_failing_bibliography_tool_is_reported_not_rerun(self):
        # a bibtex that always fails and counts its runs, like a biber that does not match biblatex
        bindir = os.path.join(self.dir, "bin")
        os.mkdir(bindir)
        tool = os.path.join(bindir, "bibtex")
        with open(tool, "w") as f:
            f.write('#!/bin/sh\necho run >> "%s/runs"\necho "I couldn\'t open style file nope.bst"\nexit 2\n' % self.dir)
        os.chmod(tool, 0o755)
        path = os.environ["PATH"]
        os.environ["PATH"] = bindir + os.pathsep + path
        self.addCleanup(os.environ.__setitem__, "PATH", path)

        self.write("refs.bib", BIB)
        cite = "\\bibliographystyle{nope}\\bibliography{refs}"
        self.write("main.tex", DOC % ("\\cite{knuth}", cite))
        for _ in range(2):
            step = tools(self.build(), "bibtex")[0]
            self.assertIn("nope.bst", step["message"])
        with open(os.path.join(self.dir, "runs")) as f:
            self.assertEqual(len(f.read().split()), 1)  # the second build did not run it again

        # changed citations: it is tried again
        self.write("main.tex", DOC % ("\\cite{lamport}", cite))
        self.build()
        with open(os.path.join(self.dir, "runs")) as f:
            self.assertEqual(len(f.read().split()), 2)


class XeLaTeXBuildTest(BuildTest):
    engine = "xelatex"

    def test_pdf_is_made_once_from_the_xdv(self):
        if not shutil.which("xdvipdfmx"):
            self.skipTest("xdvipdfmx is not installed")
        self.write("main.tex", DOC % ("Text.", ""))
        result = self.build()
        self.assertGreaterEqual(len(tools(result, "xelatex")), 1)
        self.assertEqual(len(tools(result, "xdvipdfmx")), 1)
        self.assertEqual(result["steps"][-1]["tool"], "xdvipdfmx")
        self.assertTrue(os.path.isfile(os.path.join(self.dir, "main.synctex.gz")))


if __name__ == "__main__":
    unittest.main()
