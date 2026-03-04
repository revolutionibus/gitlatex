const express = require("express");
const simpleGit = require("simple-git");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
app.use(bodyParser.json());

const BASE_DIR = path.join(__dirname, "repos");

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
    const gitDir = path.join(full, ".git");
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
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
    return { name, fileCount, lastModified, remoteUrl, owner, createdAt, createdBy };
  }));

  res.json({
    repos,
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

// Static files last so /pdf/:file and other API routes take precedence
app.use(express.static("public"));

app.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
