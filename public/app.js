const THEME_KEY = "gitlatex-theme";

let editor = null;
let currentFile = null;
let currentRepo = null;
let monacoReady = false;
let monacoReadyCallbacks = [];
let monacoApi = null;

function getStoredTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === "light" || t === "dark") return t;
  } catch (_) {}
  return "dark";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelectorAll(".theme-option").forEach(btn => {
    const value = btn.getAttribute("data-theme");
    btn.setAttribute("aria-pressed", value === theme ? "true" : "false");
    btn.classList.toggle("active", value === theme);
  });
}

function getMonacoTheme() {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "vs" : "vs-dark";
}

function setTheme(theme) {
  if (theme !== "light" && theme !== "dark") return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {}
  applyTheme(theme);
  if (monacoApi && editor) {
    monacoApi.editor.setTheme(getMonacoTheme());
  }
}

function setConsole(text) {
  const el = document.getElementById("console");
  if (!el) return;
  el.textContent = text || "";
}

// ----- Routing -----
function getRoute() {
  const hash = (window.location.hash || "#/").slice(1);
  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "editor" && parts[1]) return { page: "editor", repo: parts[1] };
  if (parts[0] === "settings") return { page: "settings" };
  return { page: "home" };
}

function showView(viewId) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.toggle("hidden", v.id !== viewId);
  });
}

function route() {
  const r = getRoute();
  if (r.page === "home") {
    showView("home-view");
    loadRepoList();
    return;
  }
  if (r.page === "settings") {
    showView("settings-view");
    applyTheme(getStoredTheme());
    return;
  }
  showView("editor-view");
  document.getElementById("editor-repo-name").textContent = decodeURIComponent(r.repo);
  openEditorPage(r.repo);
}

function openEditor(repoName) {
  window.location.hash = "#/editor/" + encodeURIComponent(repoName);
}

// ----- Home: repo list -----
async function loadRepoList() {
  const listEl = document.getElementById("repo-list");
  const emptyEl = document.getElementById("repo-list-empty");
  if (!listEl) return;
  try {
    const res = await fetch("/repos");
    const data = await res.json();
    const repos = Array.isArray(data.repos) ? data.repos : [];
    const items = repos.map(r => (typeof r === "string" ? { name: r, fileCount: null, lastModified: null, owner: null, createdAt: null, createdBy: null } : r));
    listEl.innerHTML = "";
    items.forEach(({ name, fileCount, lastModified, owner, createdAt, createdBy }) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "repo-card";
      const title = document.createElement("span");
      title.className = "repo-card-title";
      title.textContent = name;
      card.appendChild(title);
      const metaParts = [];
      if (owner) metaParts.push(owner);
      if (createdAt || createdBy) {
        const parts = [];
        if (createdAt) {
          try {
            parts.push(new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
          } catch (_) {}
        }
        if (createdBy) parts.push("by " + createdBy);
        if (parts.length) metaParts.push("Created " + parts.join(" "));
      }
      if (fileCount != null && fileCount > 0) metaParts.push(fileCount === 1 ? "1 file" : `${fileCount} files`);
      if (lastModified) {
        try {
          const d = new Date(lastModified);
          metaParts.push("Updated " + d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
        } catch (_) {}
      }
      if (metaParts.length) {
        const meta = document.createElement("span");
        meta.className = "repo-card-meta";
        meta.textContent = metaParts.join(" · ");
        card.appendChild(meta);
      }
      card.addEventListener("click", () => openEditor(name));
      listEl.appendChild(card);
    });
    if (emptyEl) emptyEl.classList.toggle("hidden", items.length > 0);
  } catch (e) {
    listEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.textContent = "Could not load repositories.";
      emptyEl.classList.remove("hidden");
    }
  }
}

function openCloneModal() {
  const modal = document.getElementById("clone-modal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    const input = document.getElementById("repoUrl");
    if (input) {
      input.value = "";
      input.focus();
    }
  }
}

function closeCloneModal() {
  const modal = document.getElementById("clone-modal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}

async function cloneRepoAndRefresh() {
  const repoUrl = document.getElementById("repoUrl");
  const url = (repoUrl && repoUrl.value || "").trim();
  if (!url) {
    alert("Enter a repository URL.");
    return;
  }
  try {
    const res = await fetch("/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: url })
    });
    const data = await res.json();
    if (data.error) {
      alert("Clone failed: " + data.error);
      return;
    }
    repoUrl.value = "";
    closeCloneModal();
    await loadRepoList();
    const name = url.split("/").pop().replace(".git", "");
    openEditor(name);
  } catch (e) {
    alert("Clone failed: " + (e.message || "Network error"));
  }
}

// ----- Editor page: init Monaco when needed -----
function ensureMonacoReady(callback) {
  if (monacoReady && editor) {
    callback();
    return;
  }
  monacoReadyCallbacks.push(callback);
  if (monacoReadyCallbacks.length > 1) return;
  require.config({ paths: { vs: "https://unpkg.com/monaco-editor@latest/min/vs" } });
  require(["vs/editor/editor.main"], function () {
    monacoApi = monaco;
    const editorEl = document.getElementById("editor");
    editor = monaco.editor.create(editorEl, {
      value: "",
      language: "latex",
      theme: getMonacoTheme()
    });
    function layoutEditor() {
      if (editor && editorEl) {
        const w = Math.max(editorEl.offsetWidth || 0, 200);
        const h = Math.max(editorEl.offsetHeight || 0, 320);
        editor.layout({ width: w, height: h });
      }
    }
    layoutEditor();
    setTimeout(layoutEditor, 0);
    window.addEventListener("resize", layoutEditor);
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(layoutEditor).observe(editorEl);
    }
    monacoReady = true;
    monacoReadyCallbacks.forEach(cb => cb());
    monacoReadyCallbacks = [];
  });
}

async function openEditorPage(repoName) {
  const decoded = decodeURIComponent(repoName);
  try {
    const res = await fetch("/select-repo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: decoded })
    });
    const data = await res.json();
    if (data.error) {
      setConsole("Failed to open repo: " + data.error);
      return;
    }
  } catch (e) {
    setConsole("Failed to open repo: " + (e.message || "Network error"));
    return;
  }
  currentRepo = decoded;
  ensureMonacoReady(() => {
    loadFiles();
  });
}

// ----- Editor: file tree & loading -----
function toggleSidebar() {
  const body = document.body;
  const hidden = body.classList.toggle("sidebar-hidden");
  const btn = document.getElementById("toggleSidebarBtn");
  if (btn) {
    btn.setAttribute("aria-label", hidden ? "Show file list" : "Hide file list");
    btn.title = hidden ? "Show file list" : "Hide file list";
  }
}

function renderFileTree(files, container, basePath = "", activePath = null) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  const currentFile = activePath;
  function walk(nodes, parentPath, parentUl) {
    (nodes || []).forEach(node => {
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
        li.dataset.path = fullPath;
        if (currentFile === fullPath) li.classList.add("active");
        if (node.name.endsWith(".tex")) li.classList.add("tex-file");
        li.addEventListener("click", () => loadFile(fullPath));
      }
      parentUl.appendChild(li);
    });
  }
  walk(files, basePath, ul);
  container.appendChild(ul);
}

function findFirstTexFile(files, basePath = "") {
  for (const node of files || []) {
    const fullPath = basePath ? `${basePath}/${node.name}` : node.name;
    if (node.type === "file" && node.name.endsWith(".tex")) return fullPath;
    if (node.type === "folder" && node.children) {
      const found = findFirstTexFile(node.children, fullPath);
      if (found) return found;
    }
  }
  return null;
}

async function loadFiles() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  try {
    const res = await fetch("/files");
    const files = await res.json();
    if (!files || !files.length) {
      sidebar.innerHTML = '<div class="sidebar-placeholder">Repository is empty.</div>';
      if (editor) editor.setValue("");
      currentFile = null;
      setConsole("");
      return;
    }
    renderFileTree(files, sidebar, "", currentFile);
    const firstTex = findFirstTexFile(files);
    if (firstTex) loadFile(firstTex);
  } catch (e) {
    sidebar.innerHTML = '<div class="sidebar-placeholder">Could not load files.</div>';
    setConsole("Error: " + (e.message || "Failed to load files"));
  }
}

async function loadFile(path) {
  try {
    const res = await fetch("/file?path=" + encodeURIComponent(path));
    const data = await res.json();
    currentFile = path;
    document.querySelectorAll("#sidebar li.file").forEach(li => {
      li.classList.toggle("active", li.dataset.path === path);
    });
    if (editor) editor.setValue(data.content || "");
  } catch (e) {
    setConsole("Error loading file: " + (e.message || path));
  }
}

async function saveCurrentFile() {
  if (!currentFile) {
    alert("No file selected to save.");
    return;
  }
  const content = editor ? editor.getValue() : "";
  try {
    await fetch("/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: currentFile, content })
    });
    setConsole("Saved " + currentFile);
  } catch (e) {
    setConsole("Save failed: " + (e.message || ""));
  }
}

async function compile() {
  if (currentFile && currentFile.endsWith(".tex")) await saveCurrentFile();
  const mainFile = (currentFile && currentFile.endsWith(".tex")) ? currentFile : "main.tex";
  try {
    const res = await fetch("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main: mainFile })
    });
    const data = await res.json();
    if (data.success && data.pdf) {
      document.getElementById("pdf").src = data.pdf;
      setConsole("Compiled " + mainFile + " successfully.");
    } else if (data.error) {
      setConsole("Compile error:\n" + data.error);
    }
  } catch (e) {
    setConsole("Compile failed: " + (e.message || ""));
  }
}

async function showCompileErrors() {
  try {
    const res = await fetch("/compile-error");
    const data = await res.json();
    setConsole(data.error ? "Last compile error:\n" + data.error : "No compile errors stored.");
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

async function commit() {
  if (currentFile) await saveCurrentFile();
  const message = prompt("Commit message:");
  if (!message) return;
  try {
    const res = await fetch("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const data = await res.json();
    setConsole(data.error ? "Commit error: " + data.error : 'Committed (no push).');
  } catch (e) {
    setConsole("Commit failed: " + (e.message || ""));
  }
}

async function pushChanges() {
  try {
    const res = await fetch("/push", { method: "POST" });
    const data = await res.json();
    setConsole(data.error ? "Push error: " + data.error : "Pushed to remote.");
  } catch (e) {
    setConsole("Push failed: " + (e.message || ""));
  }
}

async function showStatus() {
  try {
    const res = await fetch("/status");
    const data = await res.json();
    setConsole(data.error ? "Status error: " + data.error : "Git status:\n" + JSON.stringify(data.status, null, 2));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

async function showDiff() {
  try {
    const res = await fetch("/diff");
    const data = await res.json();
    setConsole(data.error ? "Diff error: " + data.error : "Git diff:\n" + (data.diff || "(no diff)"));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

// ----- Resizable panels -----
const STORAGE_KEYS = { sidebar: "gitlatex-sidebar-width", pdf: "gitlatex-pdf-width", console: "gitlatex-console-height", consoleVisible: "gitlatex-console-visible" };

function px(n) {
  return n + "px";
}

function getView() {
  return document.getElementById("editor-view");
}

function createResizeOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "resize-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize;pointer-events:auto;";
  return overlay;
}

function setupResizers() {
  const view = getView();
  const sidebar = document.getElementById("sidebar");
  const pdf = document.getElementById("pdf");
  const consoleEl = document.getElementById("console");
  if (!view || !sidebar || !pdf || !consoleEl) return;

  function loadStored() {
    const sw = localStorage.getItem(STORAGE_KEYS.sidebar);
    const pw = localStorage.getItem(STORAGE_KEYS.pdf);
    const ch = localStorage.getItem(STORAGE_KEYS.console);
    if (sw) view.style.setProperty("--sidebar-width", sw);
    if (pw) view.style.setProperty("--pdf-width", pw);
    if (ch) view.style.setProperty("--console-height", ch);
  }
  loadStored();

  function onResizeSidebar(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    view.classList.add("resizing");
    document.getElementById("resizer-sidebar").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "col-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = e2.clientX - startX;
      let w = Math.round(startW + delta);
      w = Math.max(160, Math.min(480, w));
      view.style.setProperty("--sidebar-width", px(w));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-sidebar").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.sidebar, px(sidebar.offsetWidth));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function onResizePdf(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = pdf.offsetWidth;
    view.classList.add("resizing");
    document.getElementById("resizer-pdf").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "col-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = startX - e2.clientX;
      let w = Math.round(startW + delta);
      w = Math.max(200, Math.min(window.innerWidth - 400, w));
      view.style.setProperty("--pdf-width", px(w));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-pdf").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.pdf, px(pdf.offsetWidth));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function onResizeConsole(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = consoleEl.offsetHeight;
    view.classList.add("resizing");
    document.getElementById("resizer-console").classList.add("active");
    const overlay = createResizeOverlay();
    overlay.style.cursor = "row-resize";
    document.body.appendChild(overlay);

    function move(e2) {
      const delta = startY - e2.clientY;
      let h = Math.round(startH + delta);
      h = Math.max(80, Math.min(window.innerHeight - 200, h));
      view.style.setProperty("--console-height", px(h));
    }
    function up() {
      view.classList.remove("resizing");
      document.getElementById("resizer-console").classList.remove("active");
      overlay.remove();
      localStorage.setItem(STORAGE_KEYS.console, px(consoleEl.offsetHeight));
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  document.getElementById("resizer-sidebar").addEventListener("mousedown", onResizeSidebar);
  document.getElementById("resizer-pdf").addEventListener("mousedown", onResizePdf);
  document.getElementById("resizer-console").addEventListener("mousedown", onResizeConsole);

  const consoleToggle = document.getElementById("console-toggle");
  if (consoleToggle) {
    const stored = localStorage.getItem(STORAGE_KEYS.consoleVisible);
    if (stored === "false") view.classList.add("console-hidden");
    function updateConsoleToggleLabel() {
      const hidden = view.classList.contains("console-hidden");
      consoleToggle.setAttribute("title", hidden ? "Show console" : "Hide console");
      consoleToggle.setAttribute("aria-label", hidden ? "Show console" : "Hide console");
    }
    updateConsoleToggleLabel();
    consoleToggle.addEventListener("click", function () {
      view.classList.toggle("console-hidden");
      localStorage.setItem(STORAGE_KEYS.consoleVisible, view.classList.contains("console-hidden") ? "false" : "true");
      updateConsoleToggleLabel();
    });
  }
}

// ----- Init -----
document.documentElement.setAttribute("data-theme", getStoredTheme());

document.addEventListener("click", function (e) {
  const opt = e.target.closest(".theme-option");
  if (opt) {
    const theme = opt.getAttribute("data-theme");
    if (theme) setTheme(theme);
  }
});

document.getElementById("open-clone-modal-btn")?.addEventListener("click", openCloneModal);

document.getElementById("clone-modal")?.addEventListener("click", function (e) {
  if (e.target === this) closeCloneModal();
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    const modal = document.getElementById("clone-modal");
    if (modal && !modal.classList.contains("hidden")) closeCloneModal();
  }
});

window.addEventListener("hashchange", route);
window.addEventListener("load", function () {
  route();
  setupResizers();
});
