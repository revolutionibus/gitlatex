const THEME_KEY = "gitlatex-theme";

/** API base URL: same origin, or http://localhost:3000 when on file:// or when on another port (e.g. dev server on 5173). */
function getApiBase() {
  if (typeof window === "undefined" || !window.location) return "http://localhost:3000";
  const o = window.location.origin;
  if (!o || o.startsWith("file")) return "http://localhost:3000";
  if (o.includes("localhost") && !o.endsWith(":3000")) return "http://localhost:3000";
  return "";
}
const API_BASE = getApiBase();

let editor = null;
let currentFile = null;
let currentFolderPath = null;
let currentRepo = null;
const collapsedFolderPaths = new Set();
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

/** Same as fetch but URL is relative to API_BASE (so backend works when app is opened from another port). */
function fetchApi(url, options) {
  return fetch((typeof API_BASE !== "undefined" ? API_BASE : "") + url, options);
}

/** Fetch and parse JSON; on HTML or invalid JSON return { error: message }. */
async function fetchJson(url, options) {
  const res = await fetchApi(url, options);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    const hint = (typeof API_BASE !== "undefined" && API_BASE) ? API_BASE : (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "http://localhost:3000";
    return { error: "Server returned an error page (status " + res.status + "). Is the backend running at " + hint + "?" };
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    return { error: "Invalid response (status " + res.status + "): " + (text.slice(0, 80) + (text.length > 80 ? "…" : "")) };
  }
}

// ----- Modals (input & confirm) -----
function showInputModal(options) {
  const {
    title = "Input",
    label = "Value",
    placeholder = "",
    submitLabel = "Submit",
    defaultValue = ""
  } = options || {};
  const overlay = document.getElementById("input-modal");
  const titleEl = document.getElementById("input-modal-title");
  const labelEl = document.getElementById("input-modal-label");
  const field = document.getElementById("input-modal-field");
  const submitBtn = document.getElementById("input-modal-submit");
  const cancelBtn = document.getElementById("input-modal-cancel");
  const cancelX = document.getElementById("input-modal-cancel-btn");
  if (!overlay || !field) return Promise.resolve(null);
  titleEl.textContent = title;
  labelEl.textContent = label;
  field.placeholder = placeholder;
  field.value = defaultValue;
  submitBtn.textContent = submitLabel;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  field.focus();
  return new Promise((resolve) => {
    function finish(value) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("click", clickOut);
      resolve(value);
    }
    function onKey(e) {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") {
        e.preventDefault();
        submitBtn.click();
      }
    }
    function clickOut(e) {
      if (e.target === overlay) finish(null);
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", clickOut);
    submitBtn.onclick = () => {
      const v = field.value.trim();
      finish(v || null);
    };
    cancelBtn.onclick = () => finish(null);
    cancelX.onclick = () => finish(null);
  });
}

function showConfirmModal(options) {
  const { message = "Are you sure?", confirmLabel = "Confirm" } = options || {};
  const overlay = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-modal-title");
  const messageEl = document.getElementById("confirm-modal-message");
  const okBtn = document.getElementById("confirm-modal-ok");
  const cancelBtn = document.getElementById("confirm-modal-cancel");
  const closeBtn = document.getElementById("confirm-modal-close-btn");
  if (!overlay || !messageEl) return Promise.resolve(false);
  messageEl.textContent = message;
  okBtn.textContent = confirmLabel;
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  return new Promise((resolve) => {
    function finish(ok) {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("click", clickOut);
      resolve(ok);
    }
    function onKey(e) {
      if (e.key === "Escape") finish(false);
    }
    function clickOut(e) {
      if (e.target === overlay) finish(false);
    }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", clickOut);
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    closeBtn.onclick = () => finish(false);
  });
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
    const res = await fetchApi("/repos");
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
      const meta = document.createElement("div");
      meta.className = "repo-card-meta";
      function addMetaItem(icon, text, title) {
        const item = document.createElement("span");
        item.className = "repo-meta-item";
        if (title) item.setAttribute("title", title);
        item.innerHTML = "<span class=\"material-icons repo-meta-icon\" aria-hidden=\"true\">" + icon + "</span><span>" + text + "</span>";
        meta.appendChild(item);
      }
      if (owner) addMetaItem("person", owner, "Owner");
      if (createdAt) {
        try {
          const short = new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
          addMetaItem("event", short, createdBy ? "Created " + short + " by " + createdBy : "Created " + short);
        } catch (_) {}
      }
      if (lastModified) {
        try {
          const updated = new Date(lastModified).getTime();
          const created = createdAt ? new Date(createdAt).getTime() : 0;
          if (updated >= created) {
            const short = new Date(lastModified).toLocaleDateString(undefined, { month: "short", day: "numeric" });
            addMetaItem("update", short, "Updated " + short);
          }
        } catch (_) {}
      }
      if (fileCount != null && fileCount > 0) addMetaItem("folder", fileCount === 1 ? "1 file" : fileCount + " files", null);
      if (meta.children.length) card.appendChild(meta);
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
    document.getElementById("open-clone-modal-btn")?.focus();
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
    const res = await fetchApi("/clone", {
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
    const res = await fetchApi("/select-repo", {
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

function renderFileTree(files, container, basePath = "", activePath = null, selectedFolderPath = null) {
  container.innerHTML = "";
  const ul = document.createElement("ul");
  const currentFile = activePath;
  function makeRow(name, fullPath, isFolder) {
    const row = document.createElement("span");
    row.className = "sidebar-item-row";
    const nameSpan = document.createElement("span");
    nameSpan.className = "sidebar-item-name";
    nameSpan.textContent = name;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "sidebar-delete-btn";
    delBtn.setAttribute("aria-label", isFolder ? "Delete folder" : "Delete file");
    delBtn.title = isFolder ? "Delete folder" : "Delete file";
    delBtn.innerHTML = "<span class=\"material-icons\">delete</span>";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSidebarItem(fullPath, isFolder);
    });
    row.appendChild(nameSpan);
    row.appendChild(delBtn);
    return row;
  }
  function makeFolderRow(name, fullPath, isCollapsed) {
    const row = document.createElement("span");
    row.className = "sidebar-item-row";
    const chevron = document.createElement("span");
    chevron.className = "sidebar-chevron material-icons";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = isCollapsed ? "chevron_right" : "expand_more";
    const nameSpan = document.createElement("span");
    nameSpan.className = "sidebar-item-name";
    nameSpan.textContent = name;
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "sidebar-delete-btn";
    delBtn.setAttribute("aria-label", "Delete folder");
    delBtn.title = "Delete folder";
    delBtn.innerHTML = "<span class=\"material-icons\">delete</span>";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteSidebarItem(fullPath, true);
    });
    row.appendChild(chevron);
    row.appendChild(nameSpan);
    row.appendChild(delBtn);
    return { row, chevron };
  }
  function walk(nodes, parentPath, parentUl) {
    const list = (nodes || []).slice();
    list.sort((a, b) => {
      const aFolder = a.type === "folder" ? 0 : 1;
      const bFolder = b.type === "folder" ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
    });
    list.forEach(node => {
      const li = document.createElement("li");
      const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      if (node.type === "folder") {
        li.classList.add("folder");
        li.dataset.path = fullPath;
        if (selectedFolderPath === fullPath) li.classList.add("selected");
        const isCollapsed = collapsedFolderPaths.has(fullPath);
        if (isCollapsed) li.classList.add("collapsed");
        const { row, chevron } = makeFolderRow(node.name, fullPath, isCollapsed);
        li.appendChild(row);
        const childUl = document.createElement("ul");
        walk(node.children || [], fullPath, childUl);
        li.appendChild(childUl);
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (e.target.closest(".sidebar-delete-btn")) return;
          const wasCollapsed = collapsedFolderPaths.has(fullPath);
          if (wasCollapsed) {
            collapsedFolderPaths.delete(fullPath);
            li.classList.remove("collapsed");
            chevron.textContent = "expand_more";
          } else {
            collapsedFolderPaths.add(fullPath);
            li.classList.add("collapsed");
            chevron.textContent = "chevron_right";
          }
          currentFolderPath = fullPath;
          container.querySelectorAll("li.folder").forEach(el => el.classList.toggle("selected", el.dataset.path === fullPath));
          container.querySelectorAll("li.file").forEach(el => el.classList.remove("active"));
        });
      } else {
        li.classList.add("file");
        li.dataset.path = fullPath;
        if (currentFile === fullPath && !selectedFolderPath) li.classList.add("active");
        if (node.name.endsWith(".tex")) li.classList.add("tex-file");
        const row = makeRow(node.name, fullPath, false);
        li.appendChild(row);
        row.addEventListener("click", () => {
          currentFolderPath = null;
          loadFile(fullPath);
        });
      }
      parentUl.appendChild(li);
    });
  }
  walk(files, basePath, ul);
  container.appendChild(ul);
}

async function deleteSidebarItem(path, isFolder) {
  const message = isFolder
    ? "Delete folder \u201C" + path + "\u201D and all its contents? This cannot be undone."
    : "Delete file \u201C" + path + "\u201D?";
  const ok = await showConfirmModal({ message, confirmLabel: "Delete" });
  if (!ok) return;
  try {
    const data = await fetchJson("/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path })
    });
    if (data.error) {
      setConsole("Delete failed: " + data.error);
      return;
    }
    if (currentFile === path) {
      currentFile = null;
      if (editor) editor.setValue("");
    }
    if (currentFolderPath === path || (currentFolderPath && path.startsWith(currentFolderPath + "/"))) {
      currentFolderPath = null;
    }
    await loadFiles();
    setConsole("Deleted " + path);
  } catch (e) {
    setConsole("Delete failed: " + (e.message || ""));
  }
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

function getSidebarTreeEl() {
  return document.getElementById("sidebar-tree");
}

async function loadFiles() {
  const treeEl = getSidebarTreeEl();
  if (!treeEl) return;
  try {
    const res = await fetchApi("/files");
    const files = await res.json();
    if (!files || !files.length) {
      treeEl.innerHTML = '<div class="sidebar-placeholder">Repository is empty.</div>';
      if (editor) editor.setValue("");
      currentFile = null;
      setConsole("");
      return;
    }
    renderFileTree(files, treeEl, "", currentFile, currentFolderPath);
    const firstTex = findFirstTexFile(files);
    if (firstTex) loadFile(firstTex);
  } catch (e) {
    treeEl.innerHTML = '<div class="sidebar-placeholder">Could not load files.</div>';
    setConsole("Error: " + (e.message || "Failed to load files"));
  }
}

async function loadFile(path) {
  try {
    const res = await fetchApi("/file?path=" + encodeURIComponent(path));
    const data = await res.json();
    currentFile = path;
    currentFolderPath = null;
    const treeEl = getSidebarTreeEl();
    if (treeEl) {
      treeEl.querySelectorAll("li.folder").forEach(li => li.classList.remove("selected"));
      treeEl.querySelectorAll("li.file").forEach(li => {
        li.classList.toggle("active", li.dataset.path === path);
      });
    }
    if (editor) editor.setValue(data.content || "");
  } catch (e) {
    setConsole("Error loading file: " + (e.message || path));
  }
}

async function addNewFileSidebar() {
  const prefix = currentFolderPath ? currentFolderPath + "/" : "";
  const path = await showInputModal({
    title: "New file",
    label: "File path (e.g. main.tex or chapters/intro.tex)",
    placeholder: "main.tex",
    submitLabel: "Create",
    defaultValue: prefix
  });
  if (path == null || !path.trim()) return;
  const trimmed = path.trim();
  try {
    const data = await fetchJson("/create-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: trimmed, content: "" })
    });
    if (data.error) {
      setConsole("Create file failed: " + data.error);
      return;
    }
    await loadFiles();
    loadFile(data.path || trimmed);
    setConsole("Created " + (data.path || trimmed));
  } catch (e) {
    setConsole("Create file failed: " + (e.message || ""));
  }
}

async function addNewFolderSidebar() {
  const prefix = currentFolderPath ? currentFolderPath + "/" : "";
  const path = await showInputModal({
    title: "New folder",
    label: "Folder path (e.g. chapters or sections/figures)",
    placeholder: "chapters",
    submitLabel: "Create",
    defaultValue: prefix
  });
  if (path == null || !path.trim()) return;
  const trimmed = path.trim();
  try {
    const data = await fetchJson("/create-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: trimmed })
    });
    if (data.error) {
      setConsole("Create folder failed: " + data.error);
      return;
    }
    await loadFiles();
    setConsole("Created folder " + (data.path || trimmed));
  } catch (e) {
    setConsole("Create folder failed: " + (e.message || ""));
  }
}

function uploadFilesSidebar() {
  const input = document.getElementById("sidebar-file-input");
  if (!input) return;
  input.value = "";
  input.click();
}

async function handleSidebarFileInputChange(e) {
  const input = e.target;
  const files = input.files;
  if (!files || files.length === 0) return;
  const toSend = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(",")[1];
        resolve(b64 || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const basePath = currentFolderPath ? currentFolderPath + "/" : "";
    toSend.push({ name: basePath + file.name, content: base64 });
  }
  try {
    const data = await fetchJson("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: toSend })
    });
    if (data.error) {
      setConsole("Upload failed: " + data.error);
      return;
    }
    await loadFiles();
    setConsole("Uploaded " + (data.created?.length || 0) + " file(s).");
  } catch (e) {
    setConsole("Upload failed: " + (e.message || ""));
  }
  input.value = "";
}

async function saveCurrentFile() {
  if (!currentFile) {
    await showConfirmModal({ message: "No file selected. Please open a file first.", confirmLabel: "OK" });
    return;
  }
  const content = editor ? editor.getValue() : "";
  try {
    await fetchApi("/save", {
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
    const res = await fetchApi("/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ main: mainFile })
    });
    const data = await res.json();
    if (data.success && data.pdf) {
      document.getElementById("pdf").src = (typeof API_BASE !== "undefined" ? API_BASE : "") + data.pdf;
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
    const res = await fetchApi("/compile-error");
    const data = await res.json();
    setConsole(data.error ? "Last compile error:\n" + data.error : "No compile errors stored.");
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

async function commit() {
  if (currentFile) await saveCurrentFile();
  const message = await showInputModal({
    title: "Commit",
    label: "Commit message",
    placeholder: "Your commit message",
    submitLabel: "Commit"
  });
  if (!message) return;
  try {
    const res = await fetchApi("/commit", {
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
    const res = await fetchApi("/push", { method: "POST" });
    const data = await res.json();
    setConsole(data.error ? "Push error: " + data.error : "Pushed to remote.");
  } catch (e) {
    setConsole("Push failed: " + (e.message || ""));
  }
}

async function showStatus() {
  try {
    const res = await fetchApi("/status");
    const data = await res.json();
    setConsole(data.error ? "Status error: " + data.error : "Git status:\n" + JSON.stringify(data.status, null, 2));
  } catch (e) {
    setConsole("Error: " + (e.message || ""));
  }
}

async function showDiff() {
  try {
    const res = await fetchApi("/diff");
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

document.getElementById("sidebar-new-file")?.addEventListener("click", addNewFileSidebar);
document.getElementById("sidebar-new-folder")?.addEventListener("click", addNewFolderSidebar);
document.getElementById("sidebar-upload")?.addEventListener("click", uploadFilesSidebar);
document.getElementById("sidebar-file-input")?.addEventListener("change", handleSidebarFileInputChange);

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
