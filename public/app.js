let editor;
let currentFile = null;
let currentRepo = null;

require.config({ paths: { vs: 'https://unpkg.com/monaco-editor@latest/min/vs' }});
require(['vs/editor/editor.main'], function () {
  editor = monaco.editor.create(document.getElementById('editor'), {
    value: '',
    language: 'latex',
    theme: 'vs-dark'
  });
  loadRepos();
});

function setConsole(text) {
  const el = document.getElementById("console");
  if (!el) return;
  el.textContent = text || "";
}

function toggleSidebar() {
  const body = document.body;
  const btn = document.getElementById("toggleSidebarBtn");
  const hidden = body.classList.toggle("sidebar-hidden");
  if (btn) {
    btn.textContent = hidden ? "Show Files" : "Hide Files";
  }
}

async function cloneRepo() {
  const repoUrl = document.getElementById("repoUrl").value;
  await fetch("/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl })
  });
  await loadRepos();
}

async function loadRepos() {
  const res = await fetch("/repos");
  const data = await res.json();

  const select = document.getElementById("repoSelect");
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = data.repos && data.repos.length
    ? "Select a repo..."
    : "No repos found";
  select.appendChild(placeholder);

  (data.repos || []).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (data.current === name) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  currentRepo = data.current || null;

  if (currentRepo) {
    await loadFiles();
  } else {
    const sidebar = document.getElementById("sidebar");
    sidebar.innerHTML = "No repository selected.";
    editor && editor.setValue("");
    currentFile = null;
    setConsole("");
  }
}

async function selectRepo(name) {
  if (!name) return;

  await fetch("/select-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  currentRepo = name;
  await loadFiles();
}

function renderFileTree(files, container, basePath = "") {
  container.innerHTML = "";

  const ul = document.createElement("ul");

  function walk(nodes, parentPath, parentUl) {
    nodes.forEach(node => {
      const li = document.createElement("li");
      const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;

      if (node.type === "folder") {
        li.textContent = node.name;
        li.classList.add("folder");
        const childUl = document.createElement("ul");
        walk(node.children || [], fullPath, childUl);
        li.appendChild(childUl);
      } else {
        li.textContent = node.name;
        li.classList.add("file");

        if (node.name.endsWith(".tex")) {
          li.classList.add("tex-file");
        }

        li.addEventListener("click", () => loadFile(fullPath));
      }

      parentUl.appendChild(li);
    });
  }

  walk(files, basePath, ul);
  container.appendChild(ul);
}

function findFirstTexFile(files, basePath = "") {
  for (const node of files) {
    const fullPath = basePath ? `${basePath}/${node.name}` : node.name;
    if (node.type === "file" && node.name.endsWith(".tex")) {
      return fullPath;
    }
    if (node.type === "folder" && node.children) {
      const found = findFirstTexFile(node.children, fullPath);
      if (found) return found;
    }
  }
  return null;
}

async function loadFiles() {
  const res = await fetch("/files");
  const files = await res.json();
  const sidebar = document.getElementById("sidebar");

  if (!files || !files.length) {
    sidebar.innerHTML = "No repository loaded or repository is empty.";
    editor && editor.setValue("");
    currentFile = null;
    setConsole("");
    return;
  }

  renderFileTree(files, sidebar);

  const firstTex = findFirstTexFile(files);
  if (firstTex) {
    loadFile(firstTex);
  }
}

async function loadFile(path) {
  const res = await fetch(`/file?path=${encodeURIComponent(path)}`);
  const data = await res.json();
  currentFile = path;
  if (editor) {
    editor.setValue(data.content || "");
  }
}

async function saveCurrentFile() {
  if (!currentFile) {
    alert("No file selected to save.");
    return;
  }

  const content = editor ? editor.getValue() : "";

  await fetch("/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: currentFile, content })
  });
  setConsole(`Saved ${currentFile}`);
}

async function compile() {
  if (currentFile && currentFile.endsWith(".tex")) {
    await saveCurrentFile();
  }

  const mainFile = currentFile && currentFile.endsWith(".tex")
    ? currentFile
    : "main.tex";

  const res = await fetch("/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ main: mainFile })
  });
  const data = await res.json();
  if (data.success && data.pdf) {
    document.getElementById("pdf").src = data.pdf;
    setConsole(`Compiled ${mainFile} successfully.`);
  } else if (data.error) {
    setConsole(`Compile error:\n${data.error}`);
  }
}

async function showCompileErrors() {
  const res = await fetch("/compile-error");
  const data = await res.json();
  if (!data.error) {
    setConsole("No compile errors stored.");
  } else {
    setConsole(`Last compile error:\n${data.error}`);
  }
}

async function commit() {
  if (currentFile) {
    await saveCurrentFile();
  }

  const message = prompt("Commit message:");
  if (!message) return;

  const res = await fetch("/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  const data = await res.json();
  if (data.error) {
    setConsole(`Commit error:\n${data.error}`);
  } else {
    setConsole(`Committed with message: "${message}" (no push).`);
  }
}

async function pushChanges() {
  const res = await fetch("/push", {
    method: "POST"
  });
  const data = await res.json();
  if (data.error) {
    setConsole(`Push error:\n${data.error}`);
  } else {
    setConsole("Pushed to remote.");
  }
}

async function showStatus() {
  const res = await fetch("/status");
  const data = await res.json();
  if (data.error) {
    setConsole(`Status error:\n${data.error}`);
    return;
  }
  setConsole(`Git status:\n${JSON.stringify(data.status, null, 2)}`);
}

async function showDiff() {
  const res = await fetch("/diff");
  const data = await res.json();
  if (data.error) {
    setConsole(`Diff error:\n${data.error}`);
    return;
  }
  setConsole(`Git diff:\n${data.diff || "(no diff)"}`);
}
