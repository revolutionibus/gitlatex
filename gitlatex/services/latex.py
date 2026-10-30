"""LaTeX compilation: running the engine and reading its log.

run_latex_build drives the whole cycle (engine -> bibliography -> reruns);
parse_latex_log turns the resulting log into the structured problem list the
editor shows in its Problems tab.
"""

import hashlib
import os
import re
import shutil
import subprocess

LATEX_ENGINES = ("pdflatex", "xelatex", "lualatex")

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


# Files TeX writes and reads back on the next pass. A pass is repeated only when
# one of them changed during the last one (latexmk's rule), so an ordinary edit
# compiles in a single pass.
_TRACKED_EXTS = (".aux", ".toc", ".lof", ".lot", ".out", ".bbl", ".nav", ".snm", ".ind", ".gls", ".acr")
_MAX_PASSES = 5

# The bibliography inputs as of the last biber/bibtex run, per document, so the
# tool runs only when citations, .bib files or the tool itself change (and once
# after a restart). A run that failed is remembered too, with its error, so a
# broken setup (e.g. biber and biblatex versions that do not match) is reported
# on each build instead of costing seconds every time.
_bib_inputs = {}


def _digest(paths):
    h = hashlib.sha1()
    for path in paths:
        h.update(path.encode("utf-8", "replace") + b"\0")
        try:
            with open(path, "rb") as f:
                h.update(f.read())
        except OSError:
            h.update(b"<missing>")
    return h.hexdigest()


def _tracked_files(workdir, base):
    """The main document's read-back files, and the .aux of every \\include'd file."""
    files = [base + ext for ext in _TRACKED_EXTS]
    # \include'd files are listed in the main .aux as \@input{chapters/intro.aux}
    files += re.findall(r"\\@input\{([^}]+\.aux)\}", _read(os.path.join(workdir, base + ".aux")))
    return sorted(set(os.path.join(workdir, f) for f in files))


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def _bib_signature(workdir, base, tool, aux_text):
    """What biber/bibtex reads: the citations and the .bib files' contents."""
    if tool == "biber":
        bcf = _read(os.path.join(workdir, base + ".bcf"))
        bibs = re.findall(r"<bcf:datasource[^>]*>([^<]+)</bcf:datasource>", bcf)
        cites = bcf
    else:
        bibs = [b.strip() for m in re.findall(r"\\bibdata\{([^}]*)\}", aux_text) for b in m.split(",")]
        bibs = [b if b.endswith(".bib") else b + ".bib" for b in bibs if b]
        cites = "\n".join(l for l in aux_text.splitlines() if l.startswith(("\\citation", "\\bibdata", "\\bibstyle", "\\abx@")))
    exe = shutil.which(tool) or ""
    try:
        exe += ":%d" % os.path.getmtime(exe)  # reinstalling the tool runs it again
    except OSError:
        pass
    return hashlib.sha1((cites + "\0" + exe).encode("utf-8", "replace")).hexdigest() + _digest([os.path.join(workdir, b) for b in bibs])


def _tool_error(out):
    """The first error line biber/bibtex printed, for the Problems list."""
    for line in (out or "").splitlines():
        line = line.strip()
        if re.match(r"(ERROR - |I couldn't|I found no|Illegal|Sorry---)", line):
            return re.sub(r"^ERROR - (Error: )?", "", line)
    return None


def run_latex_build(repo_path, main_file, engine="pdflatex"):
    """
    Full LaTeX build: engine -> bibliography (biber/bibtex) -> engine reruns
    until cross-references settle. Returns log, structured problems and steps.

    Like latexmk: a pass is repeated only while the files TeX reads back change,
    the bibliography tool runs only when citations or .bib files changed, and
    XeLaTeX writes its intermediate .xdv on every pass and the PDF once at the end.
    """
    base = os.path.splitext(main_file)[0]
    workdir = repo_path
    steps = []
    log_parts = []
    # XeLaTeX: skip the PDF on each pass (about a third of a pass) and convert once
    xdv = engine == "xelatex" and shutil.which("xdvipdfmx") is not None

    def engine_pass(label):
        cmd = [engine, "-interaction=nonstopmode", "-file-line-error",
               "-synctex=1"] + (["-no-pdf"] if xdv else []) + [main_file]
        try:
            code, out = _run_tool(cmd, workdir)
        except FileNotFoundError:
            raise FileNotFoundError(
                engine + " not found. Install a LaTeX distribution (e.g. TeX Live, MiKTeX)."
            )
        steps.append({"tool": engine, "label": label, "exitCode": code})
        log_parts.append("$ " + " ".join(cmd) + "\n" + out)
        return code

    def read_aux_log():
        # The .log file is far richer than stdout; prefer it when present.
        return _read(os.path.join(workdir, base + ".log"))

    tracked = lambda: _digest(_tracked_files(workdir, base))

    before = tracked()
    engine_pass("pass 1")
    passes = 1

    # Bibliography: biblatex leaves a .bcf (biber), classic bibtex leaves
    # \bibdata in the .aux. Skip entirely when neither is present, and when
    # nothing it reads changed since it last ran (and its .bbl is still there).
    aux_text = _read(os.path.join(workdir, base + ".aux"))
    bib_tool = None
    if os.path.isfile(os.path.join(workdir, base + ".bcf")):
        bib_tool = ["biber", base]
    elif "\\bibdata" in aux_text:
        bib_tool = ["bibtex", base]

    if bib_tool:
        key = (os.path.abspath(workdir), base)
        sig = _bib_signature(workdir, base, bib_tool[0], aux_text)
        last = _bib_inputs.get(key)
        if last and last["sig"] == sig and last["error"]:
            # it failed on exactly these inputs before: it would again
            steps.append({"tool": bib_tool[0], "label": "bibliography (not rerun: inputs unchanged)",
                          "exitCode": last["code"], "message": last["error"]})
        elif not last or last["sig"] != sig or not os.path.isfile(os.path.join(workdir, base + ".bbl")):
            try:
                code, out = _run_tool(bib_tool, workdir)
                error = _tool_error(out) or ("%s failed (exit code %d)" % (bib_tool[0], code) if code else None)
                step = {"tool": bib_tool[0], "label": "bibliography", "exitCode": code}
                if error and code:
                    step["message"] = error
                steps.append(step)
                log_parts.append("$ " + " ".join(bib_tool) + "\n" + out)
                _bib_inputs[key] = {"sig": sig, "code": code, "error": error if code else None}
            except FileNotFoundError:
                log_parts.append(
                    bib_tool[0] + " not found - citations may be unresolved. "
                    "Install it with your LaTeX distribution."
                )
                steps.append({"tool": bib_tool[0], "label": "bibliography", "exitCode": -1,
                              "missing": True})

    # Rerun while the read-back files (and the .bbl) keep changing, bounded.
    # A "Rerun" warning alone (e.g. a genuinely undefined \ref) does not loop.
    while passes < _MAX_PASSES:
        after = tracked()
        if after == before:
            break
        before = after
        passes += 1
        engine_pass("rerun %d" % (passes - 1))

    if xdv and os.path.isfile(os.path.join(workdir, base + ".xdv")):
        out_dir = os.path.dirname(base)
        cmd = ["xdvipdfmx", "-q", "-o", os.path.basename(base) + ".pdf", os.path.basename(base) + ".xdv"]
        code, out = _run_tool(cmd, os.path.join(workdir, out_dir) if out_dir else workdir)
        steps.append({"tool": "xdvipdfmx", "label": "pdf", "exitCode": code})
        log_parts.append("$ " + " ".join(cmd) + "\n" + out)

    full_log = read_aux_log() or "\n".join(log_parts)
    problems = parse_latex_log(full_log, main_file)

    pdf_file = os.path.join(workdir, base + ".pdf")
    error = None
    if not os.path.isfile(pdf_file):
        first_error = next((p for p in problems if p["severity"] == "error"), None)
        error = first_error["message"] if first_error else "Compilation failed - no PDF produced."
    elif steps and steps[-1]["exitCode"] not in (0, None):
        first_error = next((p for p in problems if p["severity"] == "error"), None)
        if first_error:
            error = first_error["message"]

    return {
        "log": "\n".join(log_parts) if not full_log else full_log,
        "problems": problems,
        "steps": steps,
        "error": error,
    }
