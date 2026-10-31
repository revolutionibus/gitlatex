"""EPS figures as PDF, so the editor can show them (browsers cannot draw
PostScript). The conversion uses the TeX installation's own tools, as pdfLaTeX
does when it includes an EPS: repstopdf / epstopdf, or Ghostscript directly,
always in its safe mode. The PDF is made in a temporary folder; nothing is
written into the project.
"""

import os
import shutil
import subprocess
import tempfile

# (path, mtime, size) -> PDF bytes; previews are small, a few dozen are plenty.
_cache = {}
_CACHE_SIZE = 64


def _commands(source, out):
    """The conversions to try, safest first."""
    cmds = []
    for name in ("repstopdf", "epstopdf"):
        tool = shutil.which(name)
        if tool:
            # repstopdf is epstopdf's restricted mode; epstopdf gets --restricted too.
            cmds.append([tool, "--restricted", f"--outfile={out}", source] if name == "epstopdf" else [tool, f"--outfile={out}", source])
            break
    for name in ("gswin64c", "gswin32c", "gs", "rungs"):
        tool = shutil.which(name)
        if tool:
            cmds.append([tool, "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", "-dEPSCrop", f"-sOutputFile={out}", source])
            break
    return cmds


def can_convert():
    return bool(_commands("in.eps", "out.pdf"))


def eps_to_pdf(full_path, timeout=30):
    """The EPS file at full_path as PDF bytes, or None when no converter is
    installed or the conversion fails."""
    try:
        st = os.stat(full_path)
    except OSError:
        return None
    key = (full_path, st.st_mtime_ns, st.st_size)
    if key in _cache:
        return _cache[key]
    pdf = None
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "figure.pdf")
        for cmd in _commands(full_path, out):
            try:
                subprocess.run(cmd, cwd=tmp, capture_output=True, timeout=timeout, check=False)
            except (OSError, subprocess.TimeoutExpired):
                continue
            if os.path.isfile(out) and os.path.getsize(out) > 0:
                with open(out, "rb") as f:
                    pdf = f.read()
                break
    if pdf is not None:
        if len(_cache) >= _CACHE_SIZE:
            _cache.pop(next(iter(_cache)))
        _cache[key] = pdf
    return pdf
