from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import base64
import subprocess
import tempfile
import shutil

app = Flask(__name__)

COMPILER_API_KEY = os.environ.get("COMPILER_API_KEY", "").strip()

CORS(
    app,
    resources={
        r"/*": {
            "origins": ["*"],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Accept", "X-API-Key", "Authorization"],
        }
    },
)

def _check_api_key():
    if not COMPILER_API_KEY:
        return None, None
    auth = request.headers.get("Authorization")
    key_header = request.headers.get("X-API-Key")
    token = None
    if auth and auth.startswith("Bearer "):
        token = auth[7:].strip()
    elif key_header:
        token = key_header.strip()
    if not token or token != COMPILER_API_KEY:
        return jsonify({"error": "Invalid or missing API key"}), 401
    return None, None


def _safe_main_path(main):
    if not main or not isinstance(main, str):
        return "main.tex"
    p = main.strip().replace("\\", "/").lstrip("/")
    if ".." in p or not p:
        return "main.tex"
    if not p.endswith(".tex"):
        p = p + ".tex" if p else "main.tex"
    for part in p.split("/"):
        stem, _ = os.path.splitext(part)
        if stem and not all(c.isalnum() or c in "-_" for c in stem):
            return "main.tex"
    return p


def _safe_rel_path(rel):
    if not rel or not isinstance(rel, str):
        return None
    p = rel.strip().replace("\\", "/").lstrip("/")
    if ".." in p:
        return None
    return p


@app.route("/compile", methods=["POST"])
def compile_latex():
    err_resp, err_status = _check_api_key()
    if err_resp is not None:
        return err_resp, err_status
    temp_dir = None
    try:
        data = request.json or {}
        main_file = _safe_main_path(data.get("main") or "main.tex")
        files = data.get("files") or []
        main_content = data.get("content")
        bib_content = data.get("bibliography")
        figures = data.get("figures", [])

        if files:
            if not any(f.get("path") and (f.get("content") is not None or f.get("base64")) for f in files):
                return jsonify({"error": "No file contents in 'files'"}), 400
        elif not main_content:
            return jsonify({"error": "No content provided"}), 400

        stem = os.path.splitext(main_file)[0].replace("/", os.sep)
        temp_dir = tempfile.mkdtemp()

        try:
            if files:
                for entry in files:
                    rel = _safe_rel_path(entry.get("path"))
                    if rel is None:
                        continue
                    full = os.path.join(temp_dir, rel.replace("/", os.sep))
                    dirname = os.path.dirname(full)
                    if dirname:
                        os.makedirs(dirname, exist_ok=True)
                    if "base64" in entry:
                        with open(full, "wb") as f:
                            f.write(base64.b64decode(entry["base64"] or ""))
                    else:
                        with open(full, "w", encoding="utf-8") as f:
                            f.write(entry.get("content") or "")
            else:
                figures_dir = os.path.join(temp_dir, "figures")
                os.makedirs(figures_dir, exist_ok=True)
                tex_path = os.path.join(temp_dir, main_file)
                with open(tex_path, "w", encoding="utf-8") as f:
                    f.write(main_content)
                if bib_content:
                    bib_file = os.path.join(temp_dir, "bibliography.bib")
                    with open(bib_file, "w", encoding="utf-8") as f:
                        f.write(bib_content)
                for figure in figures:
                    figure_name = os.path.basename(figure.get("name") or "fig")
                    figure_data = figure.get("data") or ""
                    if "," in figure_data:
                        figure_data = figure_data.split(",", 1)[1]
                    figure_path = os.path.join(figures_dir, figure_name)
                    with open(figure_path, "wb") as f:
                        f.write(base64.b64decode(figure_data))

            def run_command(cmd, error_msg):
                process = subprocess.run(
                    cmd,
                    cwd=temp_dir,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                if process.returncode != 0:
                    log_file = os.path.join(temp_dir, f"{stem}.log")
                    log_content = ""
                    if os.path.exists(log_file):
                        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                            log_content = f.read()
                    err_text = process.stderr or process.stdout or log_content or error_msg
                    raise RuntimeError(err_text)
                return process

            run_command(
                ["pdflatex", "-shell-escape", "-interaction=nonstopmode", "-file-line-error", main_file],
                "First LaTeX pass failed",
            )

            has_bib = bool(bib_content) or any(
                (f.get("path") or "").lower().endswith(".bib") for f in files
            )
            if has_bib:
                run_command(["bibtex", stem], "BibTeX compilation failed")

            run_command(
                ["pdflatex", "-shell-escape", "-interaction=nonstopmode", "-file-line-error", main_file],
                "Second LaTeX pass failed",
            )
            run_command(
                ["pdflatex", "-shell-escape", "-interaction=nonstopmode", "-file-line-error", main_file],
                "Final LaTeX pass failed",
            )

            pdf_path = os.path.join(temp_dir, f"{stem}.pdf")
            if not os.path.exists(pdf_path):
                return jsonify({"error": "PDF file not generated"}), 400

            with open(pdf_path, "rb") as f:
                pdf_bytes = f.read()
            pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
            pdf_data_url = f"data:application/pdf;base64,{pdf_b64}"

            return jsonify({"success": True, "pdf": pdf_data_url})

        except subprocess.TimeoutExpired:
            return jsonify({"error": "Compilation timeout"}), 408
        except RuntimeError as e:
            return jsonify({"error": str(e)}), 500
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    finally:
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass


if __name__ == "__main__":
    app.run(debug=True)
