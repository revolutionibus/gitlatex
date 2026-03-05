const express = require("express");
const simpleGit = require("simple-git");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
// Allow large payloads when sending full repo to external compiler
app.use(bodyParser.json({ limit: "50mb" }));

const BASE_DIR = path.join(__dirname, "repos");

const MIME_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon"
};

if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR);
}

let currentRepoPath = null;
let lastCompileError = null;

function countFilesInDir(dirPath) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dirPath);
    for (const name of entries) {
      const full = path.join(dirPath, name);
      if (name === ".git") continue;
      if (fs.statSync(full).isDirectory()) {
        count += countFilesInDir(full);
      } else {
        count += 1;
      }
    }
  } catch (_) {}
  return count;
}

/* Parse owner from git remote URL (e.g. github.com/owner/repo or git@github.com:owner/repo.git) */
function parseOwnerFromRemoteUrl(url) {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  const sshMatch = u.match(/[:/](?:github\.com[/:])?([^/]+)\/[^/]+(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = u.match(/github\.com[/]([^/]+)\/[^/]+/);
  if (httpsMatch) return httpsMatch[1];
  const genericMatch = u.match(/([^/]+)\/[^/]+(?:\.git)?$/);
  if (genericMatch) return genericMatch[1];
  return null;
}

/* ---------------------------
   List Repos (with metadata from git + filesystem)
----------------------------*/
app.get("/repos", async (req, res) => {
  const entries = fs.readdirSync(BASE_DIR).filter(name => {
    const full = path.join(BASE_DIR, name);
    try {
      return fs.statSync(full).isDirectory();
    } catch {
      return false;
    }
  });

  const repos = await Promise.all(entries.map(async (name) => {
    const full = path.join(BASE_DIR, name);
    let fileCount = 0;
    let lastModified = null;
    let remoteUrl = null;
    let owner = null;
    let createdAt = null;
    let createdBy = null;
    try {
      const stat = fs.statSync(full);
      lastModified = stat.mtime ? stat.mtime.toISOString() : null;
      fileCount = countFilesInDir(full);
    } catch (_) {}
    let hasGit = false;
    const gitDir = path.join(full, ".git");
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      hasGit = true;
      try {
        const git = simpleGit(full);
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === "origin");
        if (origin && origin.refs && origin.refs.fetch) {
          remoteUrl = origin.refs.fetch;
          owner = parseOwnerFromRemoteUrl(remoteUrl);
        }
        const firstCommit = await git.raw(["log", "--reverse", "-1", "--format=%aI\n%an"]);
        if (firstCommit && firstCommit.trim()) {
          const [dateStr, author] = firstCommit.trim().split("\n");
          if (dateStr) createdAt = dateStr;
          if (author) createdBy = author.trim();
        }
      } catch (_) {}
    }
    return { name, hasGit, fileCount, lastModified, remoteUrl, owner, createdAt, createdBy };
  }));

  res.json({
    repos,
    current: currentRepoPath ? path.basename(currentRepoPath) : null
  });
});

/* ---------------------------
   Delete repo (remove folder from repos/)
----------------------------*/
app.post("/delete-repo", (req, res) => {
  const name = (req.body.name || "").trim().replace(/^[/\\]+/, "");
  if (!name) return res.status(400).json({ error: "Missing repo name" });
  if (name.includes("..") || path.isAbsolute(name)) return res.status(400).json({ error: "Invalid repo name" });
  const fullPath = path.join(BASE_DIR, name);
  const realBase = path.resolve(BASE_DIR);
  const realFull = path.resolve(fullPath);
  if (realFull !== realBase && !realFull.startsWith(realBase + path.sep)) {
    return res.status(400).json({ error: "Invalid repo name" });
  }
  try {
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Repository not found" });
    if (!fs.statSync(fullPath).isDirectory()) return res.status(400).json({ error: "Not a directory" });
    if (currentRepoPath && path.resolve(currentRepoPath) === realFull) currentRepoPath = null;
    fs.rmSync(fullPath, { recursive: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Create workspace (local folder only, no git)
----------------------------*/
app.post("/create-workspace", (req, res) => {
  const raw = (req.body.name || "").trim();
  if (!raw) return res.status(400).json({ error: "Missing name" });
  const name = raw.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, "-") || "new-folder";
  const fullPath = path.join(BASE_DIR, name);
  try {
    if (fs.existsSync(fullPath)) {
      return res.status(400).json({ error: "A folder with that name already exists" });
    }
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Select Repo / Workspace
----------------------------*/
app.post("/select-repo", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing repo name" });

  const repoPath = path.join(BASE_DIR, name);
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    return res.status(404).json({ error: "Repository not found" });
  }

  currentRepoPath = repoPath;
  const gitDir = path.join(repoPath, ".git");
  const hasGit = fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory();
  res.json({ success: true, hasGit });
});

/* ---------------------------
   Clone Repo
----------------------------*/
app.post("/clone", async (req, res) => {
  const { repoUrl } = req.body;

  const repoName = repoUrl.split("/").pop().replace(".git", "");
  const repoPath = path.join(BASE_DIR, repoName);

  try {
    await simpleGit().clone(repoUrl, repoPath);
    currentRepoPath = repoPath;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Get File Tree
----------------------------*/
app.get("/files", (req, res) => {
  function readDirRecursive(dir) {
    const entries = fs.readdirSync(dir);
    const hasTexWithSameStem = (baseName) => {
      const lower = baseName.toLowerCase();
      return entries.some((e) => {
        const full = path.join(dir, e);
        if (!fs.statSync(full).isFile()) return false;
        const stem = path.basename(e, path.extname(e));
        return stem.toLowerCase() === lower && e.toLowerCase().endsWith(".tex");
      });
    };
    return entries.map((file) => {
      const full = path.join(dir, file);
      if (file === ".git") return null;
      if (fs.statSync(full).isDirectory()) {
        return { name: file, type: "folder", children: readDirRecursive(full) };
      }
      if (file.toLowerCase().endsWith(".pdf")) {
        const stem = path.basename(file, path.extname(file));
        if (hasTexWithSameStem(stem)) return null;
      }
      return { name: file, type: "file" };
    }).filter(Boolean);
  }

  if (!currentRepoPath) return res.json([]);

  res.json(readDirRecursive(currentRepoPath));
});

/* Flatten file tree to array of relative paths */
function flattenFileTree(tree, prefix = "") {
  const out = [];
  for (const node of tree) {
    const rel = prefix ? prefix + path.sep + node.name : node.name;
    if (node.type === "folder" && node.children) {
      out.push(...flattenFileTree(node.children, rel));
    } else if (node.type === "file") {
      out.push(rel);
    }
  }
  return out;
}

/* Max size for a single file to include in bundle (bytes); skip larger binaries */
const REPO_FILE_MAX_SIZE = 5 * 1024 * 1024;

/* ---------------------------
   Get all repo file contents (for external compiler)
----------------------------*/
app.get("/repo-files-content", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const tree = (function readDir(dir) {
    return fs.readdirSync(dir).map((file) => {
      const full = path.join(dir, file);
      if (file === ".git") return null;
      return fs.statSync(full).isDirectory()
        ? { name: file, type: "folder", children: readDir(full) }
        : { name: file, type: "file" };
    }).filter(Boolean);
  })(currentRepoPath);

  const paths = flattenFileTree(tree);
  const files = [];

  for (const rel of paths) {
    const fullPath = path.join(currentRepoPath, rel);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.size > REPO_FILE_MAX_SIZE) continue;

      const ext = path.extname(fullPath).toLowerCase();
      const isBinary = MIME_TYPES[ext] || /\.(pdf|zip|exe|dll)$/i.test(rel);

      if (isBinary) {
        const buf = fs.readFileSync(fullPath);
        files.push({ path: rel.replace(/\\/g, "/"), base64: buf.toString("base64") });
      } else {
        const content = fs.readFileSync(fullPath, "utf8");
        files.push({ path: rel.replace(/\\/g, "/"), content });
      }
    } catch (_) {
      // skip unreadable files
    }
  }

  res.json({ files });
});

/* ---------------------------
   Get File Content
----------------------------*/
app.get("/file", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const filePath = path.join(currentRepoPath, req.query.path);
  const ext = path.extname(filePath).toLowerCase();
  if (MIME_TYPES[ext]) {
    return res.status(415).json({ error: "Use file-raw for binary/viewable files" });
  }
  const content = fs.readFileSync(filePath, "utf8");
  res.json({ content });
});

/* ---------------------------
   Save File
----------------------------*/
app.post("/save", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const filePath = path.join(currentRepoPath, req.body.path);
  fs.writeFileSync(filePath, req.body.content);
  res.json({ success: true });
});

/* Resolve path inside repo and ensure it stays within currentRepoPath */
function resolveRepoPath(relativePath) {
  if (!currentRepoPath || relativePath == null || typeof relativePath !== "string") return null;
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "").replace(/^[/\\]+/, "");
  if (!normalized) return null;
  const full = path.resolve(currentRepoPath, normalized);
  const rel = path.relative(currentRepoPath, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

/* Serve raw file (for images, PDF viewer) - use same path join as /file then ensure under repo */
app.get("/file-raw", (req, res) => {
  if (!currentRepoPath) return res.status(400).send("No repository selected");
  const rawPath = (req.query.path || "").trim().replace(/^[/\\]+/, "");
  if (!rawPath) return res.status(400).send("Missing path");
  const fullPath = path.resolve(path.join(currentRepoPath, rawPath));
  const repoRoot = path.resolve(currentRepoPath);
  if (fullPath !== repoRoot && !fullPath.startsWith(repoRoot + path.sep)) {
    return res.status(404).send("File not found");
  }
  try {
    if (!fs.existsSync(fullPath)) return res.status(404).send("File not found");
    if (!fs.statSync(fullPath).isFile()) return res.status(404).send("Not a file");
  } catch (err) {
    return res.status(404).send("File not found");
  }
  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (mime) res.type(mime);
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) res.status(500).send("Error sending file");
  });
});

/* ---------------------------
   Create new file
----------------------------*/
app.post("/create-file", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const relativePath = (req.body.path || req.body.name || "").trim();
  if (!relativePath) return res.status(400).json({ error: "Missing path" });
  const fullPath = resolveRepoPath(relativePath);
  if (!fullPath) return res.status(400).json({ error: "Invalid path" });
  try {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = req.body.content != null ? req.body.content : "";
    fs.writeFileSync(fullPath, content);
    res.json({ success: true, path: relativePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Create folder
----------------------------*/
app.post("/create-folder", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const relativePath = (req.body.path || req.body.name || "").trim();
  if (!relativePath) return res.status(400).json({ error: "Missing path" });
  const fullPath = resolveRepoPath(relativePath);
  if (!fullPath) return res.status(400).json({ error: "Invalid path" });
  try {
    if (fs.existsSync(fullPath)) {
      return res.status(400).json({ error: "Path already exists" });
    }
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true, path: relativePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Move file or folder
----------------------------*/
app.post("/move", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const fromRel = (req.body.from || "").trim().replace(/^[/\\]+/, "");
  const toRel = (req.body.to || "").trim().replace(/^[/\\]+/, "");
  if (!fromRel || !toRel) return res.status(400).json({ error: "Missing from or to" });
  const fromFull = resolveRepoPath(fromRel);
  let toFull = resolveRepoPath(toRel);
  if (!fromFull || !toFull) return res.status(400).json({ error: "Invalid path" });
  try {
    if (!fs.existsSync(fromFull)) {
      return res.status(404).json({ error: "Source not found" });
    }
    const fromStat = fs.statSync(fromFull);
    const fromName = path.basename(fromRel);
    if (fs.existsSync(toFull) && fs.statSync(toFull).isDirectory()) {
      toFull = path.join(toFull, fromName);
    } else {
      const toDir = path.dirname(toFull);
      if (!fs.existsSync(toDir)) fs.mkdirSync(toDir, { recursive: true });
    }
    if (fromFull === toFull) return res.json({ success: true });
    const toNorm = path.normalize(toFull);
    const fromNorm = path.normalize(fromFull);
    if (fromStat.isDirectory() && (toNorm === fromNorm || toNorm.startsWith(fromNorm + path.sep))) {
      return res.status(400).json({ error: "Cannot move folder into itself or a descendant" });
    }
    if (fs.existsSync(toFull)) {
      return res.status(400).json({ error: "Destination already exists" });
    }
    fs.renameSync(fromFull, toFull);
    const newRel = path.relative(currentRepoPath, toFull).replace(/\\/g, "/");
    res.json({ success: true, path: newRel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Delete file or folder
----------------------------*/
app.post("/delete", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const relativePath = (req.body.path || req.body.name || "").trim();
  if (!relativePath) return res.status(400).json({ error: "Missing path" });
  const fullPath = resolveRepoPath(relativePath);
  if (!fullPath) return res.status(400).json({ error: "Invalid path" });
  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: "Path not found" });
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Upload files (base64 in JSON)
----------------------------*/
app.post("/upload", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const files = req.body.files;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: "No files provided" });
  }
  const created = [];
  try {
    for (const { name, content } of files) {
      const relativePath = (name || "").trim();
      if (!relativePath) continue;
      const fullPath = resolveRepoPath(relativePath);
      if (!fullPath) continue;
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(content || "", "base64");
      fs.writeFileSync(fullPath, buf);
      created.push(relativePath);
    }
    res.json({ success: true, created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Compile LaTeX
----------------------------*/
app.post("/compile", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const mainFile = req.body.main || "main.tex";

  exec(`pdflatex -interaction=nonstopmode ${mainFile}`, {
    cwd: currentRepoPath
  }, (err, stdout, stderr) => {
    if (err) {
      lastCompileError = stderr || stdout || err.message;
      return res.status(500).json({ error: lastCompileError });
    }

    lastCompileError = null;

    res.json({
      success: true,
      pdf: `/pdf/${mainFile.replace(".tex", ".pdf")}`
    });
  });
});

/* ---------------------------
   Last Compile Error
----------------------------*/
app.get("/compile-error", (req, res) => {
  if (!lastCompileError) {
    return res.json({ error: null });
  }
  res.json({ error: lastCompileError });
});

/* ---------------------------
   Save PDF (e.g. from external compiler) into current repo
   Handlers at /save-pdf and /api/save-pdf so proxies that only forward /api still work.
----------------------------*/
function handleSavePdf(req, res) {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const relativePath = (req.body.path || req.body.name || "").trim().replace(/^[/\\]+/, "");
  if (!relativePath || !relativePath.toLowerCase().endsWith(".pdf")) {
    return res.status(400).json({ error: "Missing or invalid path (must be .pdf)" });
  }
  const fullPath = resolveRepoPath(relativePath);
  if (!fullPath) return res.status(400).json({ error: "Invalid path" });
  const base64 = req.body.content;
  if (typeof base64 !== "string" || !base64) {
    return res.status(400).json({ error: "Missing content (base64)" });
  }
  try {
    const buf = Buffer.from(base64, "base64");
    if (buf.length === 0) return res.status(400).json({ error: "Invalid or empty base64 content" });
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, buf);
    res.json({ success: true, path: relativePath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
app.post("/save-pdf", handleSavePdf);
app.post("/api/save-pdf", handleSavePdf);

/* ---------------------------
   Serve PDF
----------------------------*/
app.get("/pdf", (req, res) => {
  if (!currentRepoPath) return res.status(400).send("No repository selected");
  const relativePath = (req.query.path || "").trim().replace(/^[/\\]+/, "");
  if (!relativePath) return res.status(400).send("Missing path");
  const fullPath = resolveRepoPath(relativePath);
  if (!fullPath) return res.status(404).send("Not found");
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return res.status(404).send("Not found");
  res.sendFile(fullPath);
});
app.get("/pdf/:file", (req, res) => {
  if (!currentRepoPath) return res.status(400).send("No repository selected");
  res.sendFile(path.join(currentRepoPath, req.params.file));
});

/* ---------------------------
   Commit (no push)
 ----------------------------*/
app.post("/commit", async (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const git = simpleGit(currentRepoPath);
  try {
    await git.add(".");
    await git.commit(req.body.message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Push
----------------------------*/
app.post("/push", async (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const git = simpleGit(currentRepoPath);
  try {
    await git.push();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Git Status
----------------------------*/
app.get("/status", async (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const git = simpleGit(currentRepoPath);
  try {
    const status = await git.status();
    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------
   Git Diff
----------------------------*/
app.get("/diff", async (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const git = simpleGit(currentRepoPath);
  try {
    const diff = await git.diff();
    res.json({ diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Static files last so /pdf/:file and other API routes take precedence
app.use(express.static("public"));

app.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
