from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import json
import os
import base64
import subprocess
import tempfile
import shutil
import time

app = Flask(__name__)

# Optional API key: set COMPILER_API_KEY env to require Authorization: Bearer <key> or X-API-Key: <key>
COMPILER_API_KEY = os.environ.get("COMPILER_API_KEY", "").strip()

try:
    from chessbot_api import chessbot_bp
    from chesscom import chesscom_bp
    app.register_blueprint(chessbot_bp, url_prefix="/chessbot")
    app.register_blueprint(chesscom_bp, url_prefix="/chesscom")
except ImportError:
    pass  # Run as standalone LaTeX compiler (e.g. in gitlatex)

CORS(
    app,
    resources={
        r"/*": {
            "origins": [
                "http://127.0.0.1:5500",
                "http://127.0.0.1:5501",
                "http://localhost:3000",
                "http://localhost:5173",
                "https://latex.itcpr.org",
                "https://www.latex.itcpr.org",
                "https://abdussamiakanda.web.app",
                "https://chessbd.web.app",
                "https://chessbd.app",
                "https://www.chessbd.app"
            ],
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Accept", "X-API-Key", "Authorization", "Cache-Control", "Access-Control-Allow-Origin"],
            "max_age": 86400,            # <-- cache preflight for 24h
            "supports_credentials": False
        }
    }
)

@app.after_request
def add_timing_header(resp):
    # set in each handler: g._t0 = time.perf_counter()
    try:
        dur = (getattr(request, "_t0", None) or time.perf_counter())  # fallback
        resp.headers["X-Analysis-Ms"] = str(int((time.perf_counter() - dur)*1000))
    except Exception:
        pass
    return resp

def _check_api_key():
    """If COMPILER_API_KEY is set, require a matching Bearer or X-API-Key header. Return (None, None) if ok, else (response, status)."""
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


def _safe_main_basename(main):
    """Ensure main is a safe .tex filename (no path traversal)."""
    if not main or not isinstance(main, str):
        return "main.tex"
    name = os.path.basename(main).strip()
    if not name.endswith(".tex"):
        name = name + ".tex" if name else "main.tex"
    # Only allow alphanumeric, dash, underscore in stem
    stem, ext = os.path.splitext(name)
    if not stem.replace("-", "").replace("_", "").isalnum():
        return "main.tex"
    return name


@app.route('/compile', methods=['POST'])
def compile_latex():
    """
    GitLaTeX-compatible compile endpoint.
    Request: JSON { main: "main.tex", content: "<tex>", bibliography?: "<bib>", figures?: [{name, data}] }
    Response: JSON { success: true, pdf: "data:application/pdf;base64,..." } or { error: "..." }
    """
    request._t0 = time.perf_counter()
    err_resp, err_status = _check_api_key()
    if err_resp is not None:
        return err_resp, err_status
    temp_dir = None
    try:
        data = request.json or {}
        # GitLaTeX app sends { main, content }; support legacy content-only
        main_file = _safe_main_basename(data.get("main") or "main.tex")
        main_content = data.get("content")
        bib_content = data.get("bibliography")
        figures = data.get("figures", [])

        if not main_content:
            return jsonify({"error": "No content provided"}), 400

        stem = os.path.splitext(main_file)[0]
        temp_dir = tempfile.mkdtemp()

        try:
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
                [
                    "pdflatex",
                    "-shell-escape",
                    "-interaction=nonstopmode",
                    "-file-line-error",
                    main_file,
                ],
                "First LaTeX pass failed",
            )

            if bib_content:
                run_command(["bibtex", stem], "BibTeX compilation failed")

            run_command(
                [
                    "pdflatex",
                    "-shell-escape",
                    "-interaction=nonstopmode",
                    "-file-line-error",
                    main_file,
                ],
                "Second LaTeX pass failed",
            )
            run_command(
                [
                    "pdflatex",
                    "-shell-escape",
                    "-interaction=nonstopmode",
                    "-file-line-error",
                    main_file,
                ],
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


@app.route('/')
def home():
    return jsonify({
        'status': 'running',
        'endpoints': [
            '/compile - Latex compiler'
        ]
    })

if __name__ == '__main__':
    app.run(debug=True)