const localAuthKey = "private-diary-auth";
const localDataKey = "private-diary-entries";
const apiEndpoint = "/api/diary";
const refreshIntervalMs = 10000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const loginView = document.querySelector("#loginView");
const diaryView = document.querySelector("#diaryView");
const loginForm = document.querySelector("#loginForm");
const loginNote = document.querySelector("#loginNote");
const loginMessage = document.querySelector("#loginMessage");
const passwordInput = document.querySelector("#passwordInput");
const loginButton = document.querySelector("#loginButton");
const logoutButton = document.querySelector("#logoutButton");
const syncStatus = document.querySelector("#syncStatus");

const diaryForm = document.querySelector("#diaryForm");
const entryTitle = document.querySelector("#entryTitle");
const entryDate = document.querySelector("#entryDate");
const entryMood = document.querySelector("#entryMood");
const entryCategory = document.querySelector("#entryCategory");
const categoryOptions = document.querySelector("#categoryOptions");
const entryContent = document.querySelector("#entryContent");
const entryImage = document.querySelector("#entryImage");
const imagePreview = document.querySelector("#imagePreview");
const linkTitle = document.querySelector("#linkTitle");
const linkUrl = document.querySelector("#linkUrl");
const addLinkButton = document.querySelector("#addLinkButton");
const linkList = document.querySelector("#linkList");
const saveEntryButton = document.querySelector("#saveEntryButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const saveStatus = document.querySelector("#saveStatus");
const searchInput = document.querySelector("#searchInput");
const filterDate = document.querySelector("#filterDate");
const filterCategory = document.querySelector("#filterCategory");
const entriesList = document.querySelector("#entriesList");
const entryCount = document.querySelector("#entryCount");
const clearEntries = document.querySelector("#clearEntries");
const template = document.querySelector("#entryTemplate");

let cryptoKey = null;
let entries = [];
let selectedImages = [];
let attachedLinks = [];
let editingEntryId = null;
let currentVault = { auth: null, entries: null, updatedAt: null };
let refreshTimer = null;
let isRefreshing = false;

entryDate.valueAsDate = new Date();
setupLoginText();

if (!globalThis.crypto?.subtle) {
  loginButton.disabled = true;
  loginMessage.textContent = "当前浏览器不支持加密功能，请使用新版 Chrome、Edge 或 Firefox。";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  loginButton.disabled = true;

  try {
    const password = passwordInput.value;
    currentVault = await loadVaultFromServer();

    if (!currentVault.auth) {
      const localVault = loadLocalVault();

      if (localVault.auth) {
        currentVault = localVault;
      }
    }

    if (currentVault.auth) {
      cryptoKey = await unlockKey(password, currentVault.auth);
      await loadEntries();

      if (!currentVault.updatedAt) {
        await saveVaultToServer();
      }
    } else {
      const created = await createPassword(password);
      cryptoKey = created.key;
      currentVault.auth = created.auth;
      entries = [];
      await saveEntries();
    }

    passwordInput.value = "";
    showDiary();
  } catch (error) {
    cryptoKey = null;
    loginMessage.textContent = error.message?.startsWith("无法")
      ? error.message
      : "密码不正确，无法打开日记。";
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", lockDiary);

entryImage.addEventListener("change", async () => {
  const files = Array.from(entryImage.files || []);

  if (files.length === 0) {
    return;
  }

  const images = await Promise.all(files.map(readImageFile));
  selectedImages = [...selectedImages, ...images];
  entryImage.value = "";
  renderImagePreview();
});

addLinkButton.addEventListener("click", addAttachedLink);

linkList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-link-button");

  if (!button) {
    return;
  }

  attachedLinks = attachedLinks.filter((link) => link.id !== button.dataset.id);
  renderAttachedLinks();
});

imagePreview.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-image-button");

  if (!button) {
    return;
  }

  selectedImages = selectedImages.filter((image) => image.id !== button.dataset.id);
  renderImagePreview();
});

cancelEditButton.addEventListener("click", resetForm);

diaryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const savedAt = new Date().toISOString();
  const entry = {
    id: editingEntryId || globalThis.crypto?.randomUUID?.() || String(Date.now()),
    title: entryTitle.value.trim(),
    date: entryDate.value,
    mood: entryMood.value,
    category: entryCategory.value.trim(),
    content: entryContent.value.trim(),
    images: selectedImages,
    links: attachedLinks.map(({ id, ...link }) => link),
    createdAt: savedAt,
    updatedAt: savedAt
  };

  if (editingEntryId) {
    entries = entries.map((item) => {
      if (item.id !== editingEntryId) {
        return item;
      }

      return {
        ...entry,
        createdAt: item.createdAt || savedAt
      };
    });
  } else {
    entries = [entry, ...entries];
  }

  sortEntries();
  await saveEntries();
  updateSaveStatus(editingEntryId ? "已更新并同步到服务器。" : "已保存到服务器。其他设备会自动读取最新内容。");
  resetForm();
  renderEntries();
});

clearEntries.addEventListener("click", async () => {
  if (entries.length === 0) {
    return;
  }

  entries = [];
  await saveEntries();
  updateSaveStatus("已清空并同步到服务器。");
  resetForm();
  renderEntries();
});

entriesList.addEventListener("click", async (event) => {
  const editButton = event.target.closest(".edit-button");
  const deleteButton = event.target.closest(".delete-button");

  if (editButton) {
    startEditEntry(editButton.dataset.id);
    return;
  }

  if (!deleteButton) {
    return;
  }

  entries = entries.filter((entry) => entry.id !== deleteButton.dataset.id);
  await saveEntries();
  updateSaveStatus("已删除并同步到服务器。");
  renderEntries();
});

[searchInput, filterDate, filterCategory].forEach((control) => {
  control.addEventListener("input", renderEntries);
  control.addEventListener("change", renderEntries);
});

function setupLoginText() {
  loginNote.textContent = "请输入密码打开日记。内容会加密保存到服务器，可在不同设备查看最新内容。";
}

async function createPassword(password) {
  const salt = randomBase64(16);
  const key = await deriveKey(password, salt);
  const verifier = await encryptJson(key, { ok: true });

  return {
    key,
    auth: {
      salt,
      verifier
    }
  };
}

async function unlockKey(password, auth) {
  const key = await deriveKey(password, auth.salt);
  await decryptJson(key, auth.verifier);
  return key;
}

async function deriveKey(password, saltBase64) {
  const passwordKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltBase64),
      iterations: 210000,
      hash: "SHA-256"
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function loadEntries() {
  const payload = currentVault.entries;

  if (!payload) {
    entries = [];
    renderEntries();
    return;
  }

  entries = normalizeEntries(await decryptJson(cryptoKey, payload));
  sortEntries();
  renderEntries();
}

async function saveEntries() {
  const payload = await encryptJson(cryptoKey, entries);
  currentVault.entries = payload;
  await saveVaultToServer();
}

async function loadVaultFromServer() {
  const response = await fetch(apiEndpoint, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("无法连接服务器读取日记。请确认网页是通过服务器地址打开的。");
  }

  return normalizeVault(await response.json());
}

async function saveVaultToServer() {
  const payload = normalizeVault(currentVault);
  payload.updatedAt = new Date().toISOString();

  const response = await fetch(apiEndpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("无法保存到服务器。请检查服务器是否正在运行。");
  }

  currentVault = normalizeVault(await response.json());
  saveLocalVault(currentVault);
}

function loadLocalVault() {
  return normalizeVault({
    auth: loadJson(localAuthKey),
    entries: loadJson(localDataKey)
  });
}

function saveLocalVault(vault) {
  saveJson(localAuthKey, vault.auth);
  saveJson(localDataKey, vault.entries);
}

function normalizeVault(value) {
  return {
    auth: value?.auth || null,
    entries: value?.entries || null,
    updatedAt: value?.updatedAt || null
  };
}

function normalizeEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => ({
    id: entry.id || String(Date.now()),
    title: entry.title || "",
    date: entry.date || "",
    mood: entry.mood || "平静",
    category: entry.category || "",
    content: entry.content || "",
    images: Array.isArray(entry.images)
      ? entry.images
      : entry.image ? [{ id: `${entry.id || Date.now()}-image`, data: entry.image }] : [],
    links: Array.isArray(entry.links) ? entry.links : [],
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString()
  }));
}

async function refreshFromServer() {
  if (!cryptoKey || isRefreshing) {
    return;
  }

  isRefreshing = true;

  try {
    const latestVault = await loadVaultFromServer();

    if (!latestVault.updatedAt || latestVault.updatedAt === currentVault.updatedAt) {
      return;
    }

    currentVault = latestVault;
    await loadEntries();
    updateSyncStatus("服务器已同步最新内容");
  } catch {
    updateSyncStatus("服务器连接失败");
  } finally {
    isRefreshing = false;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = window.setInterval(refreshFromServer, refreshIntervalMs);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function addAttachedLink() {
  const title = linkTitle.value.trim();
  const url = linkUrl.value.trim();

  if (!title && !url) {
    return;
  }

  attachedLinks = [
    ...attachedLinks,
    {
      id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
      title: title || url,
      url
    }
  ];
  linkTitle.value = "";
  linkUrl.value = "";
  renderAttachedLinks();
}

function startEditEntry(id) {
  const entry = entries.find((item) => item.id === id);

  if (!entry) {
    return;
  }

  editingEntryId = entry.id;
  entryTitle.value = entry.title;
  entryDate.value = entry.date;
  entryMood.value = entry.mood;
  entryCategory.value = entry.category || "";
  entryContent.value = entry.content;
  selectedImages = [...entry.images];
  attachedLinks = entry.links.map((link) => ({
    id: globalThis.crypto?.randomUUID?.() || `${entry.id}-${link.url}`,
    ...link
  }));
  saveEntryButton.textContent = "更新日记";
  cancelEditButton.hidden = false;
  renderImagePreview();
  renderAttachedLinks();
  entryTitle.focus();
}

function resetForm() {
  editingEntryId = null;
  selectedImages = [];
  attachedLinks = [];
  diaryForm.reset();
  entryDate.valueAsDate = new Date();
  saveEntryButton.textContent = "保存日记";
  cancelEditButton.hidden = true;
  renderImagePreview();
  renderAttachedLinks();
}

function renderImagePreview() {
  imagePreview.textContent = "";
  imagePreview.hidden = selectedImages.length === 0;

  selectedImages.forEach((image, index) => {
    const item = document.createElement("figure");
    item.className = "image-preview-item";

    const img = document.createElement("img");
    img.src = image.data;
    img.alt = `日记图片 ${index + 1}`;

    const button = document.createElement("button");
    button.className = "remove-image-button";
    button.type = "button";
    button.dataset.id = image.id;
    button.textContent = "移除";

    item.append(img, button);
    imagePreview.append(item);
  });
}

function renderAttachedLinks() {
  linkList.textContent = "";

  attachedLinks.forEach((link) => {
    const item = document.createElement("div");
    item.className = "attached-link";

    const text = document.createElement("span");
    text.textContent = `${link.title}${link.url ? ` · ${link.url}` : ""}`;

    const button = document.createElement("button");
    button.className = "remove-link-button";
    button.type = "button";
    button.dataset.id = link.id;
    button.textContent = "移除";

    item.append(text, button);
    linkList.append(item);
  });
}

function updateCategoryOptions() {
  const selectedCategory = filterCategory.value;
  const categories = getCategories();
  categoryOptions.textContent = "";
  filterCategory.textContent = "";

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部分类";
  filterCategory.append(all);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryOptions.append(option.cloneNode(true));
    filterCategory.append(option);
  });

  filterCategory.value = categories.includes(selectedCategory) ? selectedCategory : "";
}

function getCategories() {
  return [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function getFilteredEntries() {
  const query = searchInput.value.trim().toLowerCase();
  const date = filterDate.value;
  const category = filterCategory.value;

  return entries.filter((entry) => {
    if (date && entry.date !== date) {
      return false;
    }

    if (category && entry.category !== category) {
      return false;
    }

    if (!query) {
      return true;
    }

    const haystack = [
      entry.title,
      entry.content,
      entry.category,
      entry.mood,
      ...entry.links.map((link) => `${link.title} ${link.url}`)
    ].join(" ").toLowerCase();

    return haystack.includes(query);
  });
}

function sortEntries() {
  entries.sort((a, b) => {
    const dateCompare = (b.date || "").localeCompare(a.date || "");

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
  });
}

function updateSyncStatus(message = "") {
  syncStatus.textContent = message || "服务器同步";
}

function updateSaveStatus(message) {
  saveStatus.textContent = message;
  updateSyncStatus("服务器同步");
}

async function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      resolve({
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
        name: file.name,
        data: reader.result
      });
    });
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

async function encryptJson(key, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value))
  );

  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptJson(key, payload) {
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.data)
  );

  return JSON.parse(decoder.decode(decrypted));
}

function showDiary() {
  loginView.hidden = true;
  diaryView.hidden = false;
  updateSyncStatus();
  startAutoRefresh();
  renderEntries();
}

function lockDiary() {
  stopAutoRefresh();
  cryptoKey = null;
  entries = [];
  selectedImages = [];
  attachedLinks = [];
  saveStatus.textContent = "";
  diaryView.hidden = true;
  loginView.hidden = false;
  setupLoginText();
  passwordInput.focus();
}

function renderEntries() {
  updateCategoryOptions();
  entriesList.textContent = "";
  const filteredEntries = getFilteredEntries();
  entryCount.textContent = entries.length;

  if (filteredEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = entries.length === 0 ? "还没有日记" : "没有符合条件的日记";
    entriesList.append(empty);
    return;
  }

  filteredEntries.forEach((entry) => {
    const node = template.content.cloneNode(true);
    const mood = node.querySelector(".entry-mood");
    const category = node.querySelector(".entry-category");
    const date = node.querySelector(".entry-date");
    const title = node.querySelector(".entry-title");
    const content = node.querySelector(".entry-content");
    const images = node.querySelector(".entry-images");
    const links = node.querySelector(".entry-links");
    const editButton = node.querySelector(".edit-button");
    const deleteButton = node.querySelector(".delete-button");

    mood.textContent = entry.mood;
    category.textContent = entry.category || "未分类";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    title.textContent = entry.title;
    content.textContent = entry.content;
    editButton.dataset.id = entry.id;
    deleteButton.dataset.id = entry.id;

    entry.images.forEach((image, index) => {
      const img = document.createElement("img");
      img.src = image.data;
      img.alt = `${entry.title} 图片 ${index + 1}`;
      images.append(img);
    });

    if (entry.images.length === 0) {
      images.hidden = true;
    }

    entry.links.forEach((link) => {
      const anchor = document.createElement("a");
      anchor.href = link.url || "#";
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = link.title || link.url;
      links.append(anchor);
    });

    if (entry.links.length === 0) {
      links.hidden = true;
    }

    entriesList.append(node);
  });
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(`${value}T00:00:00`));
}

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function randomBase64(length) {
  return bytesToBase64(globalThis.crypto.getRandomValues(new Uint8Array(length)));
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
