"""LaTeX compilation: running the engine and reading its log.

run_latex_build drives the whole cycle (engine -> bibliography -> reruns);
parse_latex_log turns the resulting log into the structured problem list the
editor shows in its Problems tab.
"""

import glob
import hashlib
import os
import re
import shutil
import subprocess
import time

LATEX_ENGINES = ("pdflatex", "xelatex", "lualatex")

# "Rerun to get cross-references right", "Please rerun LaTeX", "Rerun LaTeX" etc.
_RERUN_RE = re.compile(r"rerun (?:to|LaTeX)|Please rerun|Label\(s\) may have changed", re.I)
# -file-line-error output: "./chapters/nre.tex:42: Undefined control sequence"
_FILE_LINE_RE = re.compile(r"^(?:\./)?([^:\r\n]+?):(\d+):\s*(.+)$")
# "LaTeX Warning: Reference `fig:1' on page 1 undefined on input line 42."
_WARN_LINE_RE = re.compile(
    r"^(?:LaTeX|Package(?:\s+\w+)?)\s+Warning:\s*(.+?)(?:\s+on input line\s+(\d+))?\.?$"
)


def _run_tool(cmd, cwd, timeout=180):
    """Runs a build tool; returns (returncode, combined_output)."""
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        timeout=timeout, errors="replace",
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def parse_latex_log(log_text, main_file):
    """Turns a LaTeX log into structured problems for the editor's error list."""
    problems = []
    seen = set()
    lines = (log_text or "").splitlines()
    for i, line in enumerate(lines):
        line = line.rstrip()
        entry = None

        m = _FILE_LINE_RE.match(line)
        if m and not line.startswith("!"):
            path, lineno, msg = m.group(1), int(m.group(2)), m.group(3).strip()
            # Only trust it if it looks like a source file, not a stray colon.
            if path.lower().endswith((".tex", ".sty", ".cls", ".bib")):
                low = msg.lower()
                kind = "warning" if low.startswith("warning") or "warning:" in low else "error"
                entry = (path, lineno, msg, kind)

        if entry is None and line.startswith("! "):
            msg = line[2:].strip()
            lineno = None
            # The offending line usually follows as "l.42 \badcommand"
            for look in lines[i + 1:i + 6]:
                lm = re.match(r"^l\.(\d+)", look.strip())
                if lm:
                    lineno = int(lm.group(1))
                    break
            entry = (main_file, lineno, msg, "error")

        if entry is None:
            wm = _WARN_LINE_RE.match(line.strip())
            if wm:
                lineno = int(wm.group(2)) if wm.group(2) else None
                entry = (main_file, lineno, wm.group(1).strip(), "warning")

        if entry is None:
            continue
        key = entry[:3]
        if key in seen:
            continue
        seen.add(key)
        problems.append({
            "file": entry[0].replace("\\", "/"),
            "line": entry[1],
            "message": entry[2],
            "severity": entry[3],
        })
    return problems



# Files TeX writes on one pass and reads back on the next. A pass is repeated
# only while one of them changes (latexmk's rule), so an ordinary edit compiles
# in one pass. .loa (algorithms), .thm (ntheorem) and minitoc's .mtc* are
# watched too: their packages only say "rerun", they keep nothing in the .aux.
_READ_BACK = (".aux", ".toc", ".lof", ".lot", ".loa", ".out", ".bbl", ".nav", ".snm", ".thm", ".ind", ".gls", ".acr")
_MAX_PASSES = 5

# What biber / bibtex last read, per document (and whether it failed), so the
# tool runs only when citations, .bib files or the tool itself change. A
# failure on unchanged inputs is reported again instead of rerun.
_bib_runs = {}


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _aux_files(workdir, base):
    """The main .aux and the .aux of every \\include'd file (listed in it as \\@input{…})."""
    out, todo = [], [base + ".aux"]
    while todo:
        rel = todo.pop()
        if rel in out:
            continue
        out.append(rel)
        todo += re.findall(r"\\@input\{([^}]+\.aux)\}", _read(os.path.join(workdir, rel)))
    return out


def _fingerprint(workdir, paths):
    h = hashlib.sha1()
    for rel in sorted(set(paths)):
        h.update(rel.encode("utf-8", "replace") + b"\0")
        try:
            with open(os.path.join(workdir, rel), "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"\1missing")
    return h.hexdigest()


def _read_back_state(workdir, base):
    files = [base + ext for ext in _READ_BACK] + _aux_files(workdir, base)
    files += [os.path.relpath(p, workdir) for p in glob.glob(os.path.join(workdir, glob.escape(base) + ".mtc*"))]
    return _fingerprint(workdir, files)


def _bib_signature(workdir, base, tool):
    """Everything the bibliography tool reads: the citations, the .bib files, the tool."""
    if tool == "biber":
        # The .bcf lists every citation and data source.
        bcf = _read(os.path.join(workdir, base + ".bcf"))
        bibs = re.findall(r"<bcf:datasource[^>]*>([^<]+)</bcf:datasource>", bcf)
        cites = bcf
    else:
        # bibtex reads \citation, \bibdata and \bibstyle from the main .aux and
        # from those of \include'd files.
        lines = []
        for aux in _aux_files(workdir, base):
            lines += [l for l in _read(os.path.join(workdir, aux)).splitlines() if l.startswith(("\\citation", "\\bibdata", "\\bibstyle"))]
        cites = "\n".join(lines)
        bibs = []
        for m in re.findall(r"\\bibdata\{([^}]*)\}", cites):
            bibs += [b.strip() if b.strip().endswith(".bib") else b.strip() + ".bib" for b in m.split(",") if b.strip()]
    exe = shutil.which(tool) or tool
    try:
        exe += ":%d" % os.path.getmtime(exe)  # a reinstalled tool runs again
    except OSError:
        pass
    return hashlib.sha1((cites + "\0" + exe).encode("utf-8", "replace")).hexdigest() + _fingerprint(workdir, bibs)


def _tool_error(out):
    """The first error biber or bibtex printed, for the Problems list."""
    for line in (out or "").splitlines():
        line = line.strip()
        if re.match(r"(ERROR - |I couldn't|I found no|Illegal|Sorry---)", line):
            return re.sub(r"^ERROR - (Error: )?", "", line)
    return None


def run_latex_build(repo_path, main_file, engine="pdflatex"):
    """
    Full LaTeX build: engine -> bibliography (biber/bibtex) -> engine reruns
    until cross-references settle. Returns log, structured problems and steps.

    As latexmk does it: a pass is repeated only while the files TeX reads back
    change (or, once, when the log asks for a rerun); the bibliography tool runs
    only when what it reads changed; and XeLaTeX writes its .xdv on each pass
    and the PDF once at the end.
    """
    base = os.path.splitext(main_file)[0]
    workdir = repo_path
    steps = []
    log_parts = []
    started = time.time()
    # XeLaTeX: making the PDF is about a third of a pass; do it once, at the end.
    via_xdv = engine == "xelatex" and shutil.which("xdvipdfmx") is not None

    def engine_pass(label):
        cmd = [engine, "-interaction=nonstopmode", "-file-line-error",
               "-synctex=1"] + (["-no-pdf"] if via_xdv else []) + [main_file]
        try:
            code, out = _run_tool(cmd, workdir)
        except FileNotFoundError:
            raise FileNotFoundError(
                engine + " not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
            )
        steps.append({"tool": engine, "label": label, "exitCode": code})
        log_parts.append("$ " + " ".join(cmd) + "\n" + out)
        return code

    def read_log():
        # The .log file is far richer than stdout; prefer it when present.
        return _read(os.path.join(workdir, base + ".log"))

    before = _read_back_state(workdir, base)
    engine_pass("pass 1")
    passes = 1

    # Bibliography: biblatex leaves a .bcf (biber), classic bibtex leaves
    # \bibdata in the .aux. Skip it when neither is there, or when nothing it
    # reads changed since it last ran and its .bbl is still there.
    bib_tool = None
    if os.path.isfile(os.path.join(workdir, base + ".bcf")):
        bib_tool = ["biber", base]
    elif "\\bibdata" in _read(os.path.join(workdir, base + ".aux")):
        bib_tool = ["bibtex", base]

    if bib_tool:
        key = (os.path.abspath(workdir), base)
        sig = _bib_signature(workdir, base, bib_tool[0])
        last = _bib_runs.get(key)
        unchanged = last is not None and last["sig"] == sig
        if unchanged and last["error"]:
            # It failed on exactly these inputs: it would fail again.
            steps.append({"tool": bib_tool[0], "label": "bibliography (inputs unchanged, not rerun)",
                          "exitCode": last["code"], "message": last["error"]})
        elif not unchanged or not os.path.isfile(os.path.join(workdir, base + ".bbl")):
            try:
                code, out = _run_tool(bib_tool, workdir)
                error = (_tool_error(out) or "%s failed (exit code %d)" % (bib_tool[0], code)) if code else None
                step = {"tool": bib_tool[0], "label": "bibliography", "exitCode": code}
                if error:
                    step["message"] = error
                steps.append(step)
                log_parts.append("$ " + " ".join(bib_tool) + "\n" + out)
                _bib_runs[key] = {"sig": sig, "code": code, "error": error}
            except FileNotFoundError:
                log_parts.append(
                    bib_tool[0] + " not found - citations may be unresolved. "
                    "Install it with your LaTeX distribution."
                )
                steps.append({"tool": bib_tool[0], "label": "bibliography", "exitCode": -1,
                              "missing": True})

    # Rerun while what TeX reads back keeps changing. When nothing changed but
    # the log still asks for a rerun (a package with files of its own), one
    # more pass; a genuinely undefined \ref does not loop.
    asked = False
    while passes < _MAX_PASSES:
        after = _read_back_state(workdir, base)
        if after == before:
            if asked or not _RERUN_RE.search(read_log()):
                break
            asked = True
        before = after
        passes += 1
        engine_pass("rerun %d" % (passes - 1))

    engine_code = steps[next(i for i in range(len(steps) - 1, -1, -1) if steps[i]["tool"] == engine)]["exitCode"]
    pdf_error = None
    xdv = os.path.join(workdir, base + ".xdv")
    # Only an .xdv written by this build (a fatal error leaves the last one behind).
    if via_xdv and os.path.isfile(xdv) and os.path.getmtime(xdv) >= started - 1:
        cmd = ["xdvipdfmx", "-q", "-o", base + ".pdf", base + ".xdv"]
        code, out = _run_tool(cmd, workdir)
        steps.append({"tool": "xdvipdfmx", "label": "pdf", "exitCode": code})
        log_parts.append("$ " + " ".join(cmd) + "\n" + out)
        if code:
            pdf_error = "xdvipdfmx could not make the PDF: " + ((out or "").strip().splitlines() or ["exit code %d" % code])[-1]

    full_log = read_log() or "\n".join(log_parts)
    problems = parse_latex_log(full_log, main_file)

    pdf_file = os.path.join(workdir, base + ".pdf")
    first_error = next((p for p in problems if p["severity"] == "error"), None)
    error = None
    if not os.path.isfile(pdf_file):
        error = first_error["message"] if first_error else (pdf_error or "Compilation failed - no PDF produced.")
    elif engine_code not in (0, None) and first_error:
        # The engine's own result: a later step (xdvipdfmx) succeeding does not hide its errors.
        error = first_error["message"]
    elif pdf_error:
        error = pdf_error

    return {
        "log": "\n".join(log_parts) if not full_log else full_log,
        "problems": problems,
        "steps": steps,
        "error": error,
    }
