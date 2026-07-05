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
const changePasswordButton = document.querySelector("#changePasswordButton");
const syncStatus = document.querySelector("#syncStatus");

const diaryForm = document.querySelector("#diaryForm");
const entryTitle = document.querySelector("#entryTitle");
const entryDate = document.querySelector("#entryDate");
const entryMood = document.querySelector("#entryMood");
const entryCategory = document.querySelector("#entryCategory");
const categoryOptions = document.querySelector("#categoryOptions");
const entryContent = document.querySelector("#entryContent");
const entryAttachment = document.querySelector("#entryAttachment");
const imagePreview = document.querySelector("#imagePreview");
const attachmentEditorList = document.querySelector("#attachmentEditorList");
const linkTitle = document.querySelector("#linkTitle");
const linkUrl = document.querySelector("#linkUrl");
const addLinkButton = document.querySelector("#addLinkButton");
const linkList = document.querySelector("#linkList");
const saveEntryButton = document.querySelector("#saveEntryButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const saveStatus = document.querySelector("#saveStatus");
const searchInput = document.querySelector("#searchInput");
const filterDate = document.querySelector("#filterDate");
const filterDateFrom = document.querySelector("#filterDateFrom");
const filterDateTo = document.querySelector("#filterDateTo");
const filterCategory = document.querySelector("#filterCategory");
const filterAttachmentType = document.querySelector("#filterAttachmentType");
const entriesList = document.querySelector("#entriesList");
const entryCount = document.querySelector("#entryCount");
const entrySummaryButton = document.querySelector("#entrySummaryButton");
const clearEntries = document.querySelector("#clearEntries");
const template = document.querySelector("#entryTemplate");
const entryDialog = document.querySelector("#entryDialog");
const closeEntryDialog = document.querySelector("#closeEntryDialog");
const dialogEditEntry = document.querySelector("#dialogEditEntry");
const dialogEntryMeta = document.querySelector("#dialogEntryMeta");
const dialogEntryTitle = document.querySelector("#dialogEntryTitle");
const dialogEntryContent = document.querySelector("#dialogEntryContent");
const dialogEntryImages = document.querySelector("#dialogEntryImages");
const dialogEntryAttachments = document.querySelector("#dialogEntryAttachments");
const dialogAttachmentList = document.querySelector("#dialogAttachmentList");
const dialogEntryLinkSection = document.querySelector("#dialogEntryLinkSection");
const dialogEntryLinks = document.querySelector("#dialogEntryLinks");
const dialogEntryRelated = document.querySelector("#dialogEntryRelated");
const dialogRelatedList = document.querySelector("#dialogRelatedList");
const relatedSelectedList = document.querySelector("#relatedSelectedList");
const openRelatedPicker = document.querySelector("#openRelatedPicker");
const relatedPickerDialog = document.querySelector("#relatedPickerDialog");
const closeRelatedPicker = document.querySelector("#closeRelatedPicker");
const relatedSearchInput = document.querySelector("#relatedSearchInput");
const relatedPickerList = document.querySelector("#relatedPickerList");
const saveRelatedSelection = document.querySelector("#saveRelatedSelection");
const cancelRelatedSelection = document.querySelector("#cancelRelatedSelection");
const directoryDialog = document.querySelector("#directoryDialog");
const closeDirectoryDialog = document.querySelector("#closeDirectoryDialog");
const directoryList = document.querySelector("#directoryList");
const passwordDialog = document.querySelector("#passwordDialog");
const passwordForm = document.querySelector("#passwordForm");
const oldPasswordInput = document.querySelector("#oldPasswordInput");
const newPasswordInput = document.querySelector("#newPasswordInput");
const confirmPasswordInput = document.querySelector("#confirmPasswordInput");
const passwordStatus = document.querySelector("#passwordStatus");
const savePasswordButton = document.querySelector("#savePasswordButton");
const closePasswordDialog = document.querySelector("#closePasswordDialog");
const cancelPasswordButton = document.querySelector("#cancelPasswordButton");

let cryptoKey = null;
let accessKey = null;
let entries = [];
let selectedImages = [];
let selectedAttachments = [];
let attachedLinks = [];
let selectedRelatedEntryIds = [];
let pickerRelatedEntryIds = new Set();
let editingEntryId = null;
let formEntryId = createId();
let uploadInProgress = false;
let newlyUploadedAttachmentIds = new Set();
let originalAttachmentIds = new Set();
let pendingAttachmentDeletes = [];
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
      accessKey = await deriveAccessKey(password, currentVault.auth.salt);
      await loadEntries();

      if (!currentVault.updatedAt) {
        await saveVaultToServer();
      }
    } else {
      const created = await createPassword(password);
      cryptoKey = created.key;
      accessKey = await deriveAccessKey(password, created.auth.salt);
      currentVault.auth = created.auth;
      entries = [];
      await saveEntries();
    }

    passwordInput.value = "";
    showDiary();
  } catch (error) {
    cryptoKey = null;
    accessKey = null;
    loginMessage.textContent = error.message?.startsWith("无法")
      ? error.message
      : "密码不正确，无法打开日记。";
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await cleanupNewAttachments();
  lockDiary();
});

changePasswordButton.addEventListener("click", () => {
  passwordForm.reset();
  passwordStatus.textContent = "";
  passwordDialog.showModal();
  oldPasswordInput.focus();
});

entrySummaryButton.addEventListener("click", () => {
  renderDirectory();
  directoryDialog.showModal();
});

entryAttachment.addEventListener("change", async () => {
  const files = Array.from(entryAttachment.files || []);

  if (files.length === 0) {
    return;
  }

  entryAttachment.value = "";
  if (selectedImages.length + selectedAttachments.length + files.length > 20) {
    updateSaveStatus("每篇日记最多添加 20 个附件。");
    return;
  }

  uploadInProgress = true;
  saveEntryButton.disabled = true;

  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      updateSaveStatus(`${file.name} 超过 50 MB，无法上传。`);
      continue;
    }

    try {
      await uploadAttachment(file);
    } catch (error) {
      updateSaveStatus(error.message || `${file.name} 上传失败。`);
    }
  }

  uploadInProgress = false;
  saveEntryButton.disabled = false;
  renderAttachmentEditor();
});

addLinkButton.addEventListener("click", addAttachedLink);

openRelatedPicker.addEventListener("click", () => {
  pickerRelatedEntryIds = new Set(selectedRelatedEntryIds);
  relatedSearchInput.value = "";
  renderRelatedPicker();
  relatedPickerDialog.showModal();
  relatedSearchInput.focus();
});

linkList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-link-button");

  if (!button) {
    return;
  }

  attachedLinks = attachedLinks.filter((link) => link.id !== button.dataset.id);
  renderAttachedLinks();
});

linkList.addEventListener("input", (event) => {
  const input = event.target.closest(".attached-link-input");

  if (!input) {
    return;
  }

  attachedLinks = attachedLinks.map((link) => link.id === input.dataset.id
    ? { ...link, [input.dataset.field]: input.value }
    : link);
});

imagePreview.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-image-button");

  if (!button) {
    return;
  }

  selectedImages = selectedImages.filter((image) => image.id !== button.dataset.id);
  renderImagePreview();
});

attachmentEditorList.addEventListener("click", async (event) => {
  const button = event.target.closest(".attachment-remove-button");
  if (!button) {
    return;
  }

  const attachment = selectedAttachments.find((item) => item.id === button.dataset.id);
  if (!attachment) {
    return;
  }

  selectedAttachments = selectedAttachments.filter((item) => item.id !== attachment.id);
  if (originalAttachmentIds.has(attachment.id)) {
    pendingAttachmentDeletes.push(attachment);
  } else {
    await deleteAttachment(attachment).catch(() => {});
    newlyUploadedAttachmentIds.delete(attachment.id);
  }
  renderAttachmentEditor();
});

cancelEditButton.addEventListener("click", discardFormChanges);

diaryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (uploadInProgress) {
    updateSaveStatus("请等待附件上传完成后再保存。");
    return;
  }

  if (linkTitle.value.trim() || linkUrl.value.trim()) {
    addAttachedLink();
  }

  const savedAt = new Date().toISOString();
  const entry = {
    id: formEntryId,
    title: entryTitle.value.trim(),
    date: entryDate.value,
    mood: entryMood.value.trim() || "平静",
    category: entryCategory.value.trim(),
    content: entryContent.value.trim(),
    images: selectedImages,
    attachments: selectedAttachments.map(({ status, progress, ...attachment }) => attachment),
    links: attachedLinks.map(({ id, ...link }) => link),
    relatedEntryIds: selectedRelatedEntryIds.filter((id) => id !== formEntryId),
    createdAt: savedAt,
    updatedAt: savedAt
  };

  const previousEntries = entries;
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

  try {
    saveEntryButton.disabled = true;
    sortEntries();
    await saveEntries();
    await Promise.allSettled(pendingAttachmentDeletes.map(deleteAttachment));
    newlyUploadedAttachmentIds.clear();
    pendingAttachmentDeletes = [];
    updateSaveStatus(editingEntryId ? "已更新并同步到服务器。" : "已保存到服务器。其他设备会自动读取最新内容。");
    resetForm();
    renderEntries();
  } catch (error) {
    entries = previousEntries;
    updateSaveStatus(error.message || "日记保存失败，请稍后重试。");
  } finally {
    saveEntryButton.disabled = false;
  }
});

clearEntries.addEventListener("click", async () => {
  if (entries.length === 0) {
    return;
  }

  const attachments = [
    ...entries.flatMap((entry) => entry.attachments),
    ...selectedAttachments.filter((attachment) => newlyUploadedAttachmentIds.has(attachment.id))
  ];
  entries = [];
  await saveEntries();
  await Promise.allSettled(attachments.map(deleteAttachment));
  updateSaveStatus("已清空并同步到服务器。");
  resetForm();
  renderEntries();
});

entriesList.addEventListener("click", async (event) => {
  const viewButton = event.target.closest(".view-button");
  const editButton = event.target.closest(".edit-button");
  const deleteButton = event.target.closest(".delete-button");

  if (viewButton) {
    showEntryDetails(viewButton.dataset.id);
    return;
  }

  if (editButton) {
    startEditEntry(editButton.dataset.id);
    return;
  }

  if (!deleteButton) {
    return;
  }

  const deletedEntry = entries.find((entry) => entry.id === deleteButton.dataset.id);
  entries = entries.filter((entry) => entry.id !== deleteButton.dataset.id);
  await saveEntries();
  await Promise.allSettled((deletedEntry?.attachments || []).map(deleteAttachment));
  updateSaveStatus("已删除并同步到服务器。");
  renderEntries();
});

closeEntryDialog.addEventListener("click", () => entryDialog.close());

dialogEditEntry.addEventListener("click", () => {
  const id = dialogEditEntry.dataset.id;
  entryDialog.close();
  startEditEntry(id);
});

entryDialog.addEventListener("click", (event) => {
  if (event.target === entryDialog) {
    entryDialog.close();
  }
});

closeDirectoryDialog.addEventListener("click", () => directoryDialog.close());

directoryDialog.addEventListener("click", (event) => {
  if (event.target === directoryDialog) {
    directoryDialog.close();
    return;
  }

  const item = event.target.closest(".directory-item");
  if (!item) {
    return;
  }

  directoryDialog.close();
  showEntryDetails(item.dataset.id);
});

closeRelatedPicker.addEventListener("click", () => relatedPickerDialog.close());
cancelRelatedSelection.addEventListener("click", () => relatedPickerDialog.close());

relatedPickerDialog.addEventListener("click", (event) => {
  if (event.target === relatedPickerDialog) {
    relatedPickerDialog.close();
    return;
  }

  const row = event.target.closest(".related-picker-item");
  if (!row) {
    return;
  }

  const checkbox = row.querySelector("input[type='checkbox']");
  if (event.target !== checkbox) {
    checkbox.checked = !checkbox.checked;
  }

  if (checkbox.checked) {
    pickerRelatedEntryIds.add(checkbox.value);
  } else {
    pickerRelatedEntryIds.delete(checkbox.value);
  }
});

relatedSearchInput.addEventListener("input", renderRelatedPicker);

saveRelatedSelection.addEventListener("click", () => {
  selectedRelatedEntryIds = [...pickerRelatedEntryIds].filter((id) => id !== formEntryId);
  renderSelectedRelatedEntries();
  relatedPickerDialog.close();
});

relatedSelectedList.addEventListener("click", (event) => {
  const button = event.target.closest(".remove-related-button");
  if (!button) {
    return;
  }

  selectedRelatedEntryIds = selectedRelatedEntryIds.filter((id) => id !== button.dataset.id);
  renderSelectedRelatedEntries();
});

dialogRelatedList.addEventListener("click", (event) => {
  const item = event.target.closest(".related-view-item");
  if (!item) {
    return;
  }

  showEntryDetails(item.dataset.id);
});

closePasswordDialog.addEventListener("click", () => passwordDialog.close());
cancelPasswordButton.addEventListener("click", () => passwordDialog.close());

passwordDialog.addEventListener("click", (event) => {
  if (event.target === passwordDialog) {
    passwordDialog.close();
  }
});

passwordForm.addEventListener("submit", changePassword);

[searchInput, filterDate, filterDateFrom, filterDateTo, filterCategory, filterAttachmentType].forEach((control) => {
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

async function deriveAccessKey(password, saltBase64) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`private-diary:${saltBase64}:${password}`)
  );
  return bytesToBase64(new Uint8Array(digest));
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

async function saveVaultToServer(options = {}) {
  const payload = normalizeVault(currentVault);
  payload.updatedAt = new Date().toISOString();
  const headers = {
    "Content-Type": "application/json",
    "X-Diary-Key": options.accessKey || accessKey,
    "X-Diary-Version": currentVault.updatedAt || ""
  };

  if (options.newAccessKey) {
    headers["X-Diary-New-Key"] = options.newAccessKey;
  }

  const response = await fetch(apiEndpoint, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload)
  });

  if (response.status === 409) {
    throw new Error("服务器内容已被其他设备更新，请刷新页面后再保存。");
  }

  if (!response.ok) {
    throw new Error("无法保存到服务器。请检查服务器是否正在运行。");
  }

  currentVault = normalizeVault(await response.json());
  saveLocalVault(currentVault);
}

async function changePassword(event) {
  event.preventDefault();
  passwordStatus.textContent = "";

  const oldPassword = oldPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (newPassword !== confirmPassword) {
    passwordStatus.textContent = "两次输入的新密码不一致。";
    return;
  }

  if (oldPassword === newPassword) {
    passwordStatus.textContent = "新密码不能和当前密码相同。";
    return;
  }

  try {
    savePasswordButton.disabled = true;
    const oldKey = await unlockKey(oldPassword, currentVault.auth);
    const oldAccessKey = await deriveAccessKey(oldPassword, currentVault.auth.salt);
    if (currentVault.entries) {
      await decryptJson(oldKey, currentVault.entries);
    }

    const created = await createPassword(newPassword);
    const newAccessKey = await deriveAccessKey(newPassword, created.auth.salt);
    const oldCryptoKey = cryptoKey;
    const oldVault = currentVault;

    cryptoKey = created.key;
    accessKey = newAccessKey;
    currentVault = {
      ...currentVault,
      auth: created.auth,
      entries: await encryptJson(created.key, entries)
    };

    try {
      await saveVaultToServer({ accessKey: oldAccessKey, newAccessKey });
    } catch (error) {
      cryptoKey = oldCryptoKey;
      accessKey = oldAccessKey;
      currentVault = oldVault;
      throw error;
    }

    passwordForm.reset();
    passwordStatus.textContent = "密码已修改。下次请使用新密码登录。";
    window.setTimeout(() => passwordDialog.close(), 800);
  } catch (error) {
    passwordStatus.textContent = error.message || "密码修改失败，请确认当前密码是否正确。";
  } finally {
    savePasswordButton.disabled = false;
  }
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
    attachments: Array.isArray(entry.attachments)
      ? entry.attachments.filter((attachment) => attachment?.id && attachment?.path)
      : [],
    links: normalizeLinks(entry.links),
    relatedEntryIds: Array.isArray(entry.relatedEntryIds)
      ? [...new Set(entry.relatedEntryIds.map(String).filter(Boolean))]
      : [],
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString()
  }));
}

function normalizeLinks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((link) => {
    if (typeof link === "string") {
      const text = link.trim();
      return { title: text, url: text };
    }

    const url = String(link?.url || link?.href || "").trim();
    const title = String(link?.title || link?.name || url).trim();
    return { title, url };
  }).filter((link) => link.title || link.url);
}

function normalizeLinkHref(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text;

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function createDetailLink(link) {
  const href = normalizeLinkHref(link.url);
  const item = document.createElement(href ? "a" : "div");
  item.className = "detail-link-item";

  if (href) {
    item.href = href;
    item.target = "_blank";
    item.rel = "noopener noreferrer";
  }

  const text = document.createElement("span");
  text.className = "detail-link-text";

  const title = document.createElement("strong");
  title.textContent = link.title || link.url || "未命名链接";

  const address = document.createElement("small");
  address.textContent = link.url || "未填写网址";

  const action = document.createElement("span");
  action.className = "detail-link-action";
  action.textContent = href ? "打开 ↗" : "网址无效";

  text.append(title, address);
  item.append(text, action);
  return item;
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
  formEntryId = entry.id;
  entryTitle.value = entry.title;
  entryDate.value = entry.date;
  entryMood.value = entry.mood;
  entryCategory.value = entry.category || "";
  entryContent.value = entry.content;
  selectedImages = [...entry.images];
  selectedAttachments = entry.attachments.map((attachment) => ({ ...attachment, status: "ready", progress: 100 }));
  selectedRelatedEntryIds = [...entry.relatedEntryIds];
  originalAttachmentIds = new Set(entry.attachments.map((attachment) => attachment.id));
  newlyUploadedAttachmentIds = new Set();
  pendingAttachmentDeletes = [];
  attachedLinks = entry.links.map((link) => ({
    id: globalThis.crypto?.randomUUID?.() || `${entry.id}-${link.url}`,
    ...link
  }));
  saveEntryButton.textContent = "更新日记";
  cancelEditButton.hidden = false;
  renderImagePreview();
  renderAttachmentEditor();
  renderAttachedLinks();
  renderSelectedRelatedEntries();
  entryTitle.focus();
}

async function showEntryDetails(id) {
  const entry = entries.find((item) => item.id === id);

  if (!entry) {
    return;
  }

  dialogEntryMeta.textContent = "";
  dialogEditEntry.dataset.id = entry.id;
  [entry.mood, entry.category || "未分类", formatDate(entry.date)].forEach((value) => {
    const item = document.createElement("span");
    item.textContent = value;
    dialogEntryMeta.append(item);
  });

  dialogEntryTitle.textContent = entry.title;
  dialogEntryContent.textContent = entry.content;
  dialogEntryImages.textContent = "";
  dialogAttachmentList.textContent = "";
  dialogEntryLinks.textContent = "";
  dialogRelatedList.textContent = "";

  entry.images.forEach((image, index) => {
    dialogEntryImages.append(createLegacyImagePreview(entry, image, index));
  });

  entry.links.forEach((link) => {
    dialogEntryLinks.append(createDetailLink(link));
  });

  const relatedEntries = getRelatedEntries(entry);
  relatedEntries.forEach((relatedEntry) => {
    dialogRelatedList.append(createRelatedViewItem(relatedEntry));
  });

  dialogEntryImages.hidden = entry.images.length === 0;
  dialogEntryAttachments.hidden = entry.attachments.length === 0;
  dialogEntryLinkSection.hidden = entry.links.length === 0;
  dialogEntryRelated.hidden = relatedEntries.length === 0;
  if (!entryDialog.open) {
    entryDialog.showModal();
  }

  for (const attachment of entry.attachments) {
    const loading = createAttachmentLoading(attachment);
    dialogAttachmentList.append(loading);
    try {
      const url = await getAttachmentUrl(attachment);
      loading.replaceWith(await createAttachmentPreview(attachment, url));
    } catch {
      loading.querySelector(".attachment-file-meta").textContent = "附件暂时无法读取";
    }
  }
}

function getEntryById(id) {
  return entries.find((entry) => entry.id === id);
}

function getRelatedEntries(entry) {
  const direct = (entry.relatedEntryIds || [])
    .map(getEntryById)
    .filter(Boolean);
  const reverse = entries.filter((item) => item.id !== entry.id && item.relatedEntryIds.includes(entry.id));
  return uniqueEntries([...direct, ...reverse]);
}

function uniqueEntries(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function renderSelectedRelatedEntries() {
  relatedSelectedList.textContent = "";
  const relatedEntries = selectedRelatedEntryIds.map(getEntryById).filter(Boolean);

  if (relatedEntries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "inline-empty";
    empty.textContent = "还没有关联日记。";
    relatedSelectedList.append(empty);
    return;
  }

  relatedEntries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "related-selected-item";

    const info = createEntryDigest(entry);
    const remove = document.createElement("button");
    remove.className = "remove-related-button";
    remove.type = "button";
    remove.dataset.id = entry.id;
    remove.textContent = "移除";

    item.append(info, remove);
    relatedSelectedList.append(item);
  });
}

function renderRelatedPicker() {
  relatedPickerList.textContent = "";
  const query = relatedSearchInput.value.trim().toLowerCase();
  const available = entries.filter((entry) => entry.id !== formEntryId && matchesEntryQuery(entry, query));

  if (available.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact-empty";
    empty.textContent = "没有可关联的日记。";
    relatedPickerList.append(empty);
    return;
  }

  available.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "related-picker-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = entry.id;
    checkbox.checked = pickerRelatedEntryIds.has(entry.id);

    item.append(checkbox, createEntryDigest(entry));
    relatedPickerList.append(item);
  });
}

function renderDirectory() {
  directoryList.textContent = "";
  const sorted = [...entries].sort((a, b) => {
    const dateCompare = (b.date || "").localeCompare(a.date || "");
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return (b.updatedAt || "").localeCompare(a.updatedAt || "");
  });

  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state compact-empty";
    empty.textContent = "还没有日记。";
    directoryList.append(empty);
    return;
  }

  sorted.forEach((entry) => {
    const button = document.createElement("button");
    button.className = "directory-item";
    button.type = "button";
    button.dataset.id = entry.id;
    button.append(createEntryDigest(entry, true));
    directoryList.append(button);
  });
}

function createRelatedViewItem(entry) {
  const button = document.createElement("button");
  button.className = "related-view-item";
  button.type = "button";
  button.dataset.id = entry.id;
  button.append(createEntryDigest(entry, true));
  return button;
}

function createEntryDigest(entry, includeCounts = false) {
  const item = document.createElement("div");
  item.className = "entry-digest";

  const title = document.createElement("strong");
  title.textContent = entry.title || "未命名日记";

  const meta = document.createElement("span");
  const parts = [formatDate(entry.date), entry.category || "未分类", entry.mood].filter(Boolean);
  if (includeCounts) {
    const counts = [];
    if (entry.attachments.length) counts.push(`${entry.attachments.length} 个附件`);
    if (entry.links.length) counts.push(`${entry.links.length} 个链接`);
    if (entry.relatedEntryIds.length) counts.push(`${entry.relatedEntryIds.length} 个关联`);
    parts.push(...counts);
  }
  meta.textContent = parts.join(" · ");

  const summary = document.createElement("small");
  summary.textContent = getEntrySummary(entry);

  item.append(title, meta, summary);
  return item;
}

function getEntrySummary(entry) {
  const text = String(entry.content || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "没有正文摘要。";
  }
  return text.length > 86 ? `${text.slice(0, 86)}...` : text;
}

function resetForm() {
  editingEntryId = null;
  formEntryId = createId();
  selectedImages = [];
  selectedAttachments = [];
  attachedLinks = [];
  selectedRelatedEntryIds = [];
  pickerRelatedEntryIds = new Set();
  newlyUploadedAttachmentIds = new Set();
  originalAttachmentIds = new Set();
  pendingAttachmentDeletes = [];
  diaryForm.reset();
  entryDate.valueAsDate = new Date();
  entryMood.value = "平静";
  saveEntryButton.textContent = "保存日记";
  cancelEditButton.hidden = true;
  renderImagePreview();
  renderAttachmentEditor();
  renderAttachedLinks();
  renderSelectedRelatedEntries();
}

async function discardFormChanges() {
  await cleanupNewAttachments();
  resetForm();
}

async function cleanupNewAttachments() {
  const newAttachments = selectedAttachments.filter((attachment) => newlyUploadedAttachmentIds.has(attachment.id));
  await Promise.allSettled(newAttachments.map(deleteAttachment));
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

function renderAttachmentEditor() {
  attachmentEditorList.textContent = "";

  selectedAttachments.forEach((attachment) => {
    const item = document.createElement("div");
    item.className = "attachment-editor-item";

    const icon = createAttachmentIcon(attachment);
    const info = document.createElement("div");
    info.className = "attachment-file-info";

    const name = document.createElement("span");
    name.className = "attachment-file-name";
    name.textContent = attachment.name;

    const meta = document.createElement("p");
    meta.className = "attachment-progress-text";
    meta.textContent = attachment.status === "uploading"
      ? `正在上传 ${attachment.progress || 0}%`
      : formatFileSize(attachment.size);

    info.append(name, meta);

    if (attachment.status === "uploading") {
      const progress = document.createElement("div");
      progress.className = "attachment-progress";
      const bar = document.createElement("div");
      bar.className = "attachment-progress-bar";
      bar.style.width = `${attachment.progress || 0}%`;
      progress.append(bar);
      info.append(progress);
    }

    const remove = document.createElement("button");
    remove.className = "attachment-remove-button";
    remove.type = "button";
    remove.dataset.id = attachment.id;
    remove.textContent = "移除";
    remove.disabled = attachment.status === "uploading";

    item.append(icon, info, remove);
    attachmentEditorList.append(item);
  });
}

function uploadAttachment(file) {
  const attachment = {
    id: createId(),
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    path: "",
    createdAt: new Date().toISOString(),
    status: "uploading",
    progress: 0
  };
  selectedAttachments.push(attachment);
  renderAttachmentEditor();

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/attachments/${encodeURIComponent(formEntryId)}/${encodeURIComponent(attachment.id)}`);
    request.setRequestHeader("Content-Type", attachment.type);
    request.setRequestHeader("X-Diary-Key", accessKey);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        attachment.progress = Math.round((event.loaded / event.total) * 100);
        renderAttachmentEditor();
      }
    });

    request.addEventListener("load", () => {
      if (request.status < 200 || request.status >= 300) {
        selectedAttachments = selectedAttachments.filter((item) => item.id !== attachment.id);
        renderAttachmentEditor();
        reject(new Error(`${file.name} 上传失败。`));
        return;
      }

      const response = JSON.parse(request.responseText);
      attachment.path = response.path;
      attachment.status = "ready";
      attachment.progress = 100;
      newlyUploadedAttachmentIds.add(attachment.id);
      renderAttachmentEditor();
      resolve(attachment);
    });

    request.addEventListener("error", () => {
      selectedAttachments = selectedAttachments.filter((item) => item.id !== attachment.id);
      renderAttachmentEditor();
      reject(new Error(`${file.name} 上传失败，请检查网络。`));
    });

    request.send(file);
  });
}

async function deleteAttachment(attachment) {
  const endpoint = attachmentEndpoint(attachment);
  if (!endpoint) {
    return;
  }

  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: { "X-Diary-Key": accessKey }
  });
  if (!response.ok) {
    throw new Error("附件删除失败");
  }
}

async function getAttachmentUrl(attachment) {
  const endpoint = attachmentEndpoint(attachment);
  if (!endpoint) {
    throw new Error("附件地址无效");
  }

  const response = await fetch(`${endpoint}/url`, {
    method: "POST",
    headers: { "X-Diary-Key": accessKey }
  });
  if (!response.ok) {
    throw new Error("附件读取失败");
  }
  return (await response.json()).url;
}

function attachmentEndpoint(attachment) {
  const parts = String(attachment.path || "").split("/");
  if (parts.length !== 3 || parts[0] !== "attachments") {
    return "";
  }
  return `/api/attachments/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
}

function createLegacyImagePreview(entry, image, index) {
  const preview = document.createElement("div");
  preview.className = "attachment-preview";

  const img = document.createElement("img");
  img.src = image.data;
  img.alt = `${entry.title} 图片 ${index + 1}`;

  const actions = document.createElement("div");
  actions.className = "attachment-preview-actions";
  const name = document.createElement("span");
  name.className = "attachment-file-name";
  name.textContent = image.name || `日记图片 ${index + 1}.jpg`;
  const download = document.createElement("a");
  download.className = "attachment-download-button";
  download.href = image.data;
  download.download = image.name || `日记图片-${index + 1}.jpg`;
  download.textContent = "下载";
  actions.append(name, download);
  preview.append(img, actions);
  return preview;
}

function createAttachmentLoading(attachment) {
  const item = document.createElement("div");
  item.className = "attachment-file-row";
  const icon = createAttachmentIcon(attachment);
  const info = document.createElement("div");
  info.className = "attachment-file-info";
  const name = document.createElement("span");
  name.className = "attachment-file-name";
  name.textContent = attachment.name;
  const meta = document.createElement("p");
  meta.className = "attachment-file-meta";
  meta.textContent = "正在加载附件...";
  info.append(name, meta);
  item.append(icon, info);
  return item;
}

async function createAttachmentPreview(attachment, url) {
  const preview = document.createElement("div");
  preview.className = "attachment-preview";
  const type = attachment.type || "application/octet-stream";
  const extension = getFileExtension(attachment.name);

  try {
    if (type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = attachment.name;
      preview.append(img);
    } else if (type.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      video.preload = "metadata";
      preview.append(video);
    } else if (type.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.src = url;
      audio.controls = true;
      audio.preload = "metadata";
      preview.append(audio);
    } else if (type === "application/pdf" || extension === "pdf") {
      const frame = document.createElement("iframe");
      frame.src = url;
      frame.title = attachment.name;
      preview.append(frame);
    } else if (extension === "docx") {
      preview.append(await createWordPreview(url));
    } else if (["xlsx", "xls", "csv"].includes(extension)) {
      preview.append(await createSpreadsheetPreview(url));
    } else if (extension === "pptx") {
      preview.append(await createPowerPointPreview(url));
    } else if (isTextFile(type, extension)) {
      preview.append(await createTextPreview(url));
    } else {
      preview.append(createUnsupportedPreview(attachment));
    }
  } catch {
    preview.append(createPreviewMessage("文件内容预览失败，可以尝试在新窗口打开或下载。"));
  }

  const actions = document.createElement("div");
  actions.className = "attachment-preview-actions";
  const info = document.createElement("div");
  info.className = "attachment-file-info";
  const name = document.createElement("span");
  name.className = "attachment-file-name";
  name.textContent = attachment.name;
  const meta = document.createElement("p");
  meta.className = "attachment-file-meta";
  meta.textContent = `${fileTypeLabel(attachment)} · ${formatFileSize(attachment.size)}`;
  info.append(name, meta);

  const download = document.createElement("a");
  download.className = "attachment-download-button";
  download.href = `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(attachment.name)}`;
  download.target = "_blank";
  download.rel = "noopener noreferrer";
  download.textContent = "下载";

  const open = document.createElement("a");
  open.className = "attachment-download-button";
  open.href = url;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "打开";

  const commands = document.createElement("div");
  commands.className = "attachment-preview-commands";
  commands.append(open, download);
  actions.append(info, commands);
  preview.append(actions);
  return preview;
}

async function fetchAttachmentBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("附件读取失败");
  }
  return response.arrayBuffer();
}

async function createTextPreview(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("文本读取失败");
  }
  const text = await response.text();
  const pre = document.createElement("pre");
  pre.className = "file-text-preview";
  pre.textContent = text.slice(0, 500000);
  if (text.length > 500000) {
    pre.textContent += "\n\n[内容较长，预览仅显示前 500,000 个字符]";
  }
  return pre;
}

async function createWordPreview(url) {
  if (!globalThis.mammoth) {
    throw new Error("Word 解析器未加载");
  }
  const result = await globalThis.mammoth.convertToHtml({ arrayBuffer: await fetchAttachmentBuffer(url) });
  const parsed = new DOMParser().parseFromString(result.value, "text/html");
  parsed.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((node) => node.remove());
  parsed.body.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || name === "style") {
        element.removeAttribute(attribute.name);
      }
      if (name === "href" && !/^(https?:|mailto:|#)/.test(value)) {
        element.removeAttribute(attribute.name);
      }
      if (name === "src" && !value.startsWith("data:image/")) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  const container = document.createElement("div");
  container.className = "office-document-preview";
  [...parsed.body.childNodes].forEach((node) => container.append(document.importNode(node, true)));
  return container;
}

async function createSpreadsheetPreview(url) {
  if (!globalThis.XLSX) {
    throw new Error("表格解析器未加载");
  }
  const workbook = globalThis.XLSX.read(await fetchAttachmentBuffer(url), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const rows = globalThis.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: ""
  }).slice(0, 200);

  const wrapper = document.createElement("div");
  wrapper.className = "spreadsheet-preview";
  const label = document.createElement("p");
  label.className = "attachment-file-meta";
  label.textContent = `工作表：${sheetName}${rows.length === 200 ? "（仅显示前 200 行）" : ""}`;
  const scroller = document.createElement("div");
  scroller.className = "spreadsheet-scroll";
  const table = document.createElement("table");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.slice(0, 40).forEach((cell) => {
      const element = document.createElement(rowIndex === 0 ? "th" : "td");
      element.textContent = String(cell);
      tr.append(element);
    });
    table.append(tr);
  });
  scroller.append(table);
  wrapper.append(label, scroller);
  return wrapper;
}

async function createPowerPointPreview(url) {
  if (!globalThis.JSZip) {
    throw new Error("PowerPoint 解析器未加载");
  }
  const zip = await globalThis.JSZip.loadAsync(await fetchAttachmentBuffer(url));
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .slice(0, 100);
  const container = document.createElement("div");
  container.className = "powerpoint-preview";

  for (let index = 0; index < slideNames.length; index += 1) {
    const xml = await zip.file(slideNames[index]).async("text");
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    const texts = [...documentXml.getElementsByTagName("a:t")].map((node) => node.textContent).filter(Boolean);
    const slide = document.createElement("section");
    const title = document.createElement("h4");
    title.textContent = `第 ${index + 1} 页`;
    const content = document.createElement("p");
    content.textContent = texts.join("\n") || "此页没有可提取的文字内容";
    slide.append(title, content);
    container.append(slide);
  }
  return container;
}

function createUnsupportedPreview(attachment) {
  return createPreviewMessage(`暂不支持在线解析 ${getFileExtension(attachment.name).toUpperCase() || "此类型"} 文件。你仍可尝试“打开”或下载后查看。`);
}

function createPreviewMessage(message) {
  const notice = document.createElement("div");
  notice.className = "file-preview-notice";
  notice.textContent = message;
  return notice;
}

function isTextFile(type, extension) {
  return type.startsWith("text/") || [
    "txt", "md", "json", "xml", "html", "htm", "css", "js", "ts", "jsx", "tsx",
    "py", "java", "c", "h", "cpp", "cs", "go", "rs", "php", "rb", "sql", "log",
    "yaml", "yml", "ini", "conf", "ps1", "sh", "bat"
  ].includes(extension);
}

function getFileExtension(name) {
  const value = String(name || "");
  return value.includes(".") ? value.split(".").pop().toLowerCase() : "";
}

function createAttachmentIcon(attachment) {
  const icon = document.createElement("span");
  icon.className = "attachment-type-icon";
  const name = attachment.name || "";
  const extension = name.includes(".") ? name.split(".").pop().slice(0, 4) : "file";
  icon.textContent = extension || "file";
  return icon;
}

function fileTypeLabel(attachment) {
  const type = attachment.type || "";
  const extension = getFileExtension(attachment.name);
  if (type.startsWith("image/")) return "图片";
  if (type.startsWith("video/")) return "视频";
  if (type.startsWith("audio/")) return "音频";
  if (type === "application/pdf" || extension === "pdf") return "PDF";
  if (["doc", "docx"].includes(extension)) return "Word 文档";
  if (["xls", "xlsx", "csv"].includes(extension)) return "表格";
  if (["ppt", "pptx"].includes(extension)) return "PowerPoint";
  if (isTextFile(type, extension)) return "文本文件";
  return "文件";
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderAttachedLinks() {
  linkList.textContent = "";

  attachedLinks.forEach((link) => {
    const item = document.createElement("div");
    item.className = "attached-link";

    const fields = document.createElement("div");
    fields.className = "attached-link-fields";
    fields.append(
      createAttachedLinkField(link, "title", "链接名称", "水费账户"),
      createAttachedLinkField(link, "url", "网址", "https://...")
    );

    const button = document.createElement("button");
    button.className = "remove-link-button";
    button.type = "button";
    button.dataset.id = link.id;
    button.textContent = "移除";

    item.append(fields, button);
    linkList.append(item);
  });
}

function createAttachedLinkField(link, field, labelText, placeholder) {
  const label = document.createElement("label");
  label.className = "attached-link-field";

  const text = document.createElement("span");
  text.textContent = labelText;

  const input = document.createElement("input");
  input.className = "attached-link-input";
  input.type = field === "url" ? "url" : "text";
  input.value = link[field] || "";
  input.placeholder = placeholder;
  input.dataset.id = link.id;
  input.dataset.field = field;

  if (field === "title") {
    input.maxLength = 60;
  }

  label.append(text, input);
  return label;
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
  const dateFrom = filterDateFrom.value;
  const dateTo = filterDateTo.value;
  const category = filterCategory.value;
  const attachmentType = filterAttachmentType.value;

  return entries.filter((entry) => {
    if (date && entry.date !== date) {
      return false;
    }

    if (dateFrom && entry.date < dateFrom) {
      return false;
    }

    if (dateTo && entry.date > dateTo) {
      return false;
    }

    if (category && entry.category !== category) {
      return false;
    }

    if (attachmentType && !entry.attachments.some((attachment) => getAttachmentKind(attachment) === attachmentType)) {
      return false;
    }

    return matchesEntryQuery(entry, query);
  });
}

function matchesEntryQuery(entry, query) {
  if (!query) {
    return true;
  }

  const relatedText = (entry.relatedEntryIds || [])
    .map(getEntryById)
    .filter(Boolean)
    .map((item) => `${item.title} ${item.date} ${item.category} ${item.content}`)
    .join(" ");

  const haystack = [
    entry.title,
    entry.content,
    entry.category,
    entry.mood,
    ...entry.attachments.map((attachment) => `${attachment.name} ${fileTypeLabel(attachment)}`),
    ...entry.links.map((link) => `${link.title} ${link.url}`),
    relatedText
  ].join(" ").toLowerCase();

  return haystack.includes(query);
}

function getAttachmentKind(attachment) {
  const type = attachment.type || "";
  const extension = getFileExtension(attachment.name);
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  if (["doc", "docx"].includes(extension)) return "doc";
  if (["xls", "xlsx", "csv"].includes(extension)) return "sheet";
  if (["ppt", "pptx"].includes(extension)) return "ppt";
  if (isTextFile(type, extension)) return "text";
  return "other";
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
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1920;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
    name: file.name,
    data: canvas.toDataURL("image/jpeg", 0.82)
  };
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
  accessKey = null;
  entries = [];
  selectedImages = [];
  selectedAttachments = [];
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
    const attachmentSummary = node.querySelector(".entry-attachment-summary");
    const links = node.querySelector(".entry-links");
    const viewButton = node.querySelector(".view-button");
    const editButton = node.querySelector(".edit-button");
    const deleteButton = node.querySelector(".delete-button");

    mood.textContent = entry.mood;
    category.textContent = entry.category || "未分类";
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    title.textContent = entry.title;
    content.textContent = entry.content;
    viewButton.dataset.id = entry.id;
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

    const summaryParts = [];
    if (entry.attachments.length > 0) {
      summaryParts.push(`${entry.attachments.length} 个附件`);
    }
    if (entry.relatedEntryIds.length > 0) {
      summaryParts.push(`${entry.relatedEntryIds.length} 个关联日记`);
    }

    if (summaryParts.length > 0) {
      attachmentSummary.hidden = false;
      attachmentSummary.textContent = summaryParts.join(" · ");
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
