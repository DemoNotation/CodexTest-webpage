const authKey = "private-diary-auth";
const dataKey = "private-diary-entries";
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

const diaryForm = document.querySelector("#diaryForm");
const entryTitle = document.querySelector("#entryTitle");
const entryDate = document.querySelector("#entryDate");
const entryMood = document.querySelector("#entryMood");
const entryContent = document.querySelector("#entryContent");
const entryImage = document.querySelector("#entryImage");
const imagePreview = document.querySelector("#imagePreview");
const previewImage = document.querySelector("#previewImage");
const removeImage = document.querySelector("#removeImage");
const entriesList = document.querySelector("#entriesList");
const entryCount = document.querySelector("#entryCount");
const clearEntries = document.querySelector("#clearEntries");
const template = document.querySelector("#entryTemplate");

let cryptoKey = null;
let entries = [];
let selectedImage = "";

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
    const auth = loadJson(authKey);

    if (auth) {
      cryptoKey = await unlockKey(password, auth);
      await loadEntries();
    } else {
      cryptoKey = await createPassword(password);
      entries = [];
      await saveEntries();
    }

    passwordInput.value = "";
    showDiary();
  } catch {
    cryptoKey = null;
    loginMessage.textContent = "密码不正确，无法打开日记。";
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", lockDiary);

entryImage.addEventListener("change", () => {
  const file = entryImage.files[0];

  if (!file) {
    clearImage();
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    selectedImage = reader.result;
    previewImage.src = selectedImage;
    imagePreview.hidden = false;
  });
  reader.readAsDataURL(file);
});

removeImage.addEventListener("click", clearImage);

diaryForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const entry = {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    title: entryTitle.value.trim(),
    date: entryDate.value,
    mood: entryMood.value,
    content: entryContent.value.trim(),
    image: selectedImage,
    createdAt: new Date().toISOString()
  };

  entries = [entry, ...entries];
  await saveEntries();
  renderEntries();
  diaryForm.reset();
  entryDate.valueAsDate = new Date();
  clearImage();
  entryTitle.focus();
});

clearEntries.addEventListener("click", async () => {
  if (entries.length === 0) {
    return;
  }

  entries = [];
  await saveEntries();
  renderEntries();
});

entriesList.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-button");

  if (!button) {
    return;
  }

  entries = entries.filter((entry) => entry.id !== button.dataset.id);
  await saveEntries();
  renderEntries();
});

function setupLoginText() {
  const hasPassword = Boolean(localStorage.getItem(authKey));

  loginNote.textContent = hasPassword
    ? "请输入密码打开日记。日记内容加密保存在当前浏览器里。"
    : "第一次使用时，请设置一个至少 6 位的密码。请记住它，忘记后无法恢复日记。";
}

async function createPassword(password) {
  const salt = randomBase64(16);
  const key = await deriveKey(password, salt);
  const verifier = await encryptJson(key, { ok: true });

  saveJson(authKey, {
    salt,
    verifier
  });

  return key;
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
  const payload = loadJson(dataKey);

  if (!payload) {
    entries = [];
    renderEntries();
    return;
  }

  entries = await decryptJson(cryptoKey, payload);
  renderEntries();
}

async function saveEntries() {
  const payload = await encryptJson(cryptoKey, entries);
  saveJson(dataKey, payload);
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
  renderEntries();
}

function lockDiary() {
  cryptoKey = null;
  entries = [];
  selectedImage = "";
  diaryView.hidden = true;
  loginView.hidden = false;
  setupLoginText();
  passwordInput.focus();
}

function clearImage() {
  selectedImage = "";
  entryImage.value = "";
  previewImage.removeAttribute("src");
  imagePreview.hidden = true;
}

function renderEntries() {
  entriesList.textContent = "";
  entryCount.textContent = entries.length;

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "还没有日记";
    entriesList.append(empty);
    return;
  }

  entries.forEach((entry) => {
    const node = template.content.cloneNode(true);
    const image = node.querySelector(".entry-image");
    const mood = node.querySelector(".entry-mood");
    const date = node.querySelector(".entry-date");
    const title = node.querySelector(".entry-title");
    const content = node.querySelector(".entry-content");
    const deleteButton = node.querySelector(".delete-button");

    if (entry.image) {
      image.src = entry.image;
      image.alt = entry.title;
    } else {
      image.classList.add("is-hidden");
    }

    mood.textContent = entry.mood;
    date.dateTime = entry.date;
    date.textContent = formatDate(entry.date);
    title.textContent = entry.title;
    content.textContent = entry.content;
    deleteButton.dataset.id = entry.id;

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
