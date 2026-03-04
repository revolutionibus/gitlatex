const express = require("express");
const simpleGit = require("simple-git");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const BASE_DIR = path.join(__dirname, "repos");

if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR);
}

let currentRepoPath = null;
let lastCompileError = null;

/* ---------------------------
   List Repos
----------------------------*/
app.get("/repos", (req, res) => {
  const entries = fs.readdirSync(BASE_DIR).filter(name => {
    const full = path.join(BASE_DIR, name);
    try {
      return fs.statSync(full).isDirectory();
    } catch {
      return false;
    }
  });

  res.json({
    repos: entries,
    current: currentRepoPath ? path.basename(currentRepoPath) : null
  });
});

/* ---------------------------
   Select Repo
----------------------------*/
app.post("/select-repo", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing repo name" });

  const repoPath = path.join(BASE_DIR, name);
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    return res.status(404).json({ error: "Repository not found" });
  }

  currentRepoPath = repoPath;
  res.json({ success: true });
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
    return fs.readdirSync(dir).map(file => {
      const full = path.join(dir, file);
      // Skip VCS metadata directories
      if (file === ".git") {
        return null;
      }
      return fs.statSync(full).isDirectory()
        ? { name: file, type: "folder", children: readDirRecursive(full) }
        : { name: file, type: "file" };
    }).filter(Boolean);
  }

  if (!currentRepoPath) return res.json([]);

  res.json(readDirRecursive(currentRepoPath));
});

/* ---------------------------
   Get File Content
----------------------------*/
app.get("/file", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).json({ error: "No repository selected" });
  }
  const filePath = path.join(currentRepoPath, req.query.path);
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
   Serve PDF
----------------------------*/
app.get("/pdf/:file", (req, res) => {
  if (!currentRepoPath) {
    return res.status(400).send("No repository selected");
  }
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

app.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
