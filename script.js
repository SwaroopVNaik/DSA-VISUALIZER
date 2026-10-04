const DB_NAME = "DSAVisualizerDB";
const DB_VERSION = 1;
const STORE = "items";

let db;
let currentFolderId = null;
let currentFolderName = "My DSA Files";
let folderStack = [];
let modalMode = null;
let modalParentId = null;

const $ = (id) => document.getElementById(id);

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => reject(request.error);
  });
}

function putItem(item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function getAllItems() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteItem(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRecursive(id) {
  const all = await getAllItems();
  const children = all.filter(item => item.parentId === id);

  for (const child of children) {
    await deleteRecursive(child.id);
  }

  await deleteItem(id);
}

async function getChildren(parentId) {
  const all = await getAllItems();
  return all.filter(item => item.parentId === parentId)
            .sort((a, b) => {
              if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
}

async function render() {
  $("dashboardView").classList.remove("hidden");
  $("runnerView").classList.add("hidden");

  const children = await getChildren(currentFolderId);

  $("currentTitle").textContent = currentFolderName;
  $("currentSubtitle").textContent =
    currentFolderId ? "HTML visualizers stored inside this folder." :
    "Folders and visualizers saved in this browser.";

  $("itemCount").textContent =
    `${children.length} item${children.length === 1 ? "" : "s"}`;

  $("backBtn").classList.toggle("hidden", currentFolderId === null);
  $("emptyState").classList.toggle("hidden", children.length !== 0);

  $("itemsGrid").innerHTML = "";

  for (const item of children) {
    const card = document.createElement("div");
    card.className = "card";

    const icon = item.type === "folder" ? "📁" : "🌐";
    const info = item.type === "folder"
      ? "Folder"
      : "HTML Visualizer";

    card.innerHTML = `
      <div>
        <div class="card-top">
          <div class="icon">${icon}</div>
        </div>
        <h3></h3>
        <p>${info}</p>
      </div>
      <div class="card-actions">
        <button class="small-btn open-btn">${item.type === "folder" ? "Open" : "Run"}</button>
        <button class="small-btn rename-btn">Rename</button>
        <button class="small-btn delete-btn">Delete</button>
      </div>
    `;

    card.querySelector("h3").textContent = item.name;

    card.querySelector(".open-btn").onclick = () => {
      if (item.type === "folder") {
        folderStack.push({
          id: currentFolderId,
          name: currentFolderName
        });
        currentFolderId = item.id;
        currentFolderName = item.name;
        render();
      } else {
        openVisualizer(item);
      }
    };

    card.querySelector(".rename-btn").onclick = () => {
      openRenameModal(item);
    };

    card.querySelector(".delete-btn").onclick = async () => {
      const message = item.type === "folder"
        ? `Delete folder "${item.name}" and everything inside it?`
        : `Delete "${item.name}"?`;

      if (!confirm(message)) return;

      await deleteRecursive(item.id);
      showToast("Deleted");
      render();
    };

    $("itemsGrid").appendChild(card);
  }

  renderBreadcrumb();
}

function renderBreadcrumb() {
  const parts = [`<span>🏠 My DSA Files</span>`];

  for (const part of folderStack) {
    if (part.id !== null) {
      parts.push(" / ");
      parts.push(`<span>${escapeHtml(part.name)}</span>`);
    }
  }

  if (currentFolderId !== null) {
    parts.push(" / ");
    parts.push(`<span>${escapeHtml(currentFolderName)}</span>`);
  }

  $("breadcrumb").innerHTML = parts.join("");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

function showModal(title, placeholder, mode, parentId = null) {
  modalMode = mode;
  modalParentId = parentId;

  $("modalTitle").textContent = title;
  $("modalInput").placeholder = placeholder;
  $("modalInput").value = "";
  $("modal").classList.remove("hidden");
  setTimeout(() => $("modalInput").focus(), 0);
}

function closeModal() {
  $("modal").classList.add("hidden");
  modalMode = null;
  modalParentId = null;
}

function openRenameModal(item) {
  modalMode = "rename";
  modalParentId = item.id;
  $("modalTitle").textContent = "Rename";
  $("modalInput").placeholder = "New name";
  $("modalInput").value = item.name;
  $("modal").classList.remove("hidden");
  setTimeout(() => $("modalInput").focus(), 0);
}

async function confirmModal() {
  const value = $("modalInput").value.trim();
  if (!value) return;

  if (modalMode === "folder") {
    await putItem({
      id: makeId(),
      type: "folder",
      name: value,
      parentId: modalParentId,
      createdAt: Date.now()
    });
    showToast("Folder created");
  }

  if (modalMode === "rename") {
    const all = await getAllItems();
    const item = all.find(x => x.id === modalParentId);
    if (item) {
      item.name = value;
      await putItem(item);
      showToast("Renamed");
    }
  }

  closeModal();
  render();
}

async function uploadFiles(fileList) {
  for (const file of fileList) {
    const isHtml = file.name.toLowerCase().endsWith(".html") ||
                   file.name.toLowerCase().endsWith(".htm");

    if (!isHtml) {
      showToast("Only HTML files are supported");
      continue;
    }

    const content = await file.text();

    await putItem({
      id: makeId(),
      type: "file",
      name: file.name,
      parentId: currentFolderId,
      content,
      size: file.size,
      createdAt: Date.now()
    });
  }

  showToast("Visualizer uploaded");
  $("fileInput").value = "";
  render();
}

function openVisualizer(item) {
  $("dashboardView").classList.add("hidden");
  $("runnerView").classList.remove("hidden");
  $("runnerTitle").textContent = item.name;

  // The original HTML is placed into srcdoc.
  // We do not parse, rewrite, style, or modify its contents.
  const frame = $("visualizerFrame");
  frame.srcdoc = item.content;
}

function closeVisualizer() {
  $("visualizerFrame").srcdoc = "";
  $("runnerView").classList.add("hidden");
  $("dashboardView").classList.remove("hidden");
}

$("newFolderBtn").onclick = () => {
  showModal("Create Folder", "Folder name", "folder", currentFolderId);
};

$("uploadBtn").onclick = () => $("fileInput").click();

$("fileInput").onchange = (event) => {
  uploadFiles(event.target.files);
};

$("confirmModal").onclick = confirmModal;
$("cancelModal").onclick = closeModal;

$("modalInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") confirmModal();
  if (event.key === "Escape") closeModal();
});

$("backBtn").onclick = () => {
  const previous = folderStack.pop();

  if (!previous) {
    currentFolderId = null;
    currentFolderName = "My DSA Files";
  } else {
    currentFolderId = previous.id;
    currentFolderName = previous.name;
  }

  render();
};

$("runnerBackBtn").onclick = closeVisualizer;
$("closeRunnerBtn").onclick = closeVisualizer;

$("modal").addEventListener("click", (event) => {
  if (event.target === $("modal")) closeModal();
});

async function init() {
  try {
    await openDB();
    await render();
  } catch (error) {
    console.error(error);
    alert("Could not open browser storage. Please use a modern browser.");
  }
}

init();
