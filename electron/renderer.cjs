const { ipcRenderer } = require("electron");

const tabsEl = document.getElementById("tabs");
const tabCountEl = document.getElementById("tabCount");
const emptyEl = document.getElementById("emptyState");
const bodyEl = document.getElementById("body");
const titleEl = document.getElementById("title");
const messageEl = document.getElementById("message");
const optionsEl = document.getElementById("options");
const answerInput = document.getElementById("answerInput");
const answerBtn = document.getElementById("answerBtn");
const dismissBtn = document.getElementById("dismissBtn");
const muteBtn = document.getElementById("muteBtn");
const dismissAllBtn = document.getElementById("dismissAllBtn");
const bellIcon = document.getElementById("bellIcon");

// Each tab keeps its own draft state so switching back and forth doesn't lose
// what the user typed / picked.
const tabs = new Map(); // id → { title, message, options, selectionMode, allowText, draftText, draftSelections (Set<number>), unread }
let activeId = null;
let muted = false;

let audioContext = null;
let audioFailed = false;
let ringInterval = null;

function createRingSound() {
  if (audioFailed || muted) return;
  try {
    if (!audioContext) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        audioFailed = true;
        return;
      }
      audioContext = new Ctx();
    }
    const now = audioContext.currentTime;

    const o1 = audioContext.createOscillator();
    const g1 = audioContext.createGain();
    o1.connect(g1);
    g1.connect(audioContext.destination);
    o1.frequency.setValueAtTime(830, now);
    o1.type = "sine";
    g1.gain.setValueAtTime(0.3, now);
    g1.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    o1.start(now);
    o1.stop(now + 0.5);

    const o2 = audioContext.createOscillator();
    const g2 = audioContext.createGain();
    o2.connect(g2);
    g2.connect(audioContext.destination);
    o2.frequency.setValueAtTime(1660, now);
    o2.type = "sine";
    g2.gain.setValueAtTime(0.15, now);
    g2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    o2.start(now);
    o2.stop(now + 0.3);
  } catch (err) {
    audioFailed = true;
    console.error("Audio error:", err);
    stopRinging();
  }
}

function startRinging() {
  if (muted) return;
  if (ringInterval) return;
  createRingSound();
  ringInterval = setInterval(() => {
    if (!muted) createRingSound();
  }, 1200);
}

function stopRinging() {
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (audioContext) {
    try {
      audioContext.close();
    } catch {
      /* ignore */
    }
    audioContext = null;
  }
}

function setMuted(value) {
  muted = Boolean(value);
  muteBtn.textContent = muted ? "🔇 Muted" : "🔊 Sound";
  muteBtn.classList.toggle("active", muted);
  bellIcon.classList.toggle("silent", muted);
  if (muted) {
    stopRinging();
  } else if (Array.from(tabs.values()).some((t) => t.unread)) {
    startRinging();
  }
  ipcRenderer.send("set-muted", muted);
}

function updateTabCount() {
  const n = tabs.size;
  tabCountEl.textContent = n > 0 ? `· ${n} ${n === 1 ? "tab" : "tabs"}` : "";
  if (n === 0) {
    emptyEl.style.display = "";
    bodyEl.classList.add("hidden");
    stopRinging();
  } else {
    emptyEl.style.display = "none";
    bodyEl.classList.remove("hidden");
  }
}

function renderTabBar() {
  tabsEl.innerHTML = "";
  for (const [id, tab] of tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    if (id === activeId) tabEl.classList.add("active");
    if (tab.unread && id !== activeId) tabEl.classList.add("unread");

    const titleSpan = document.createElement("span");
    titleSpan.className = "tab-title";
    titleSpan.textContent = tab.title;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Dismiss this tab";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      sendResponse(id, { answered: false, response: "" });
    });

    tabEl.addEventListener("click", () => switchTo(id));

    tabEl.appendChild(titleSpan);
    tabEl.appendChild(closeBtn);
    tabsEl.appendChild(tabEl);
  }
}

function captureDraft() {
  if (!activeId) return;
  const tab = tabs.get(activeId);
  if (!tab) return;
  tab.draftText = answerInput.value;
  tab.draftSelections = new Set();
  optionsEl.querySelectorAll("input:checked").forEach((input) => {
    const idx = parseInt(input.dataset.idx || "-1", 10);
    if (idx >= 0) tab.draftSelections.add(idx);
  });
}

function renderActiveTab() {
  if (!activeId || !tabs.has(activeId)) {
    return;
  }
  const tab = tabs.get(activeId);
  tab.unread = false;

  titleEl.textContent = tab.title;
  messageEl.textContent = tab.message;

  // Reset & build options
  optionsEl.innerHTML = "";
  if (tab.options && tab.options.length > 0) {
    optionsEl.classList.add("show");
    tab.options.forEach((label, idx) => {
      const item = document.createElement("label");
      item.className = "option-item";
      item.htmlFor = `opt-${idx}`;

      const input = document.createElement("input");
      input.type = tab.selectionMode === "single" ? "radio" : "checkbox";
      input.name = "ring-option";
      input.id = `opt-${idx}`;
      input.value = label;
      input.dataset.idx = String(idx);
      if (tab.draftSelections && tab.draftSelections.has(idx)) {
        input.checked = true;
        item.classList.add("checked");
      }

      input.addEventListener("change", () => {
        if (tab.selectionMode === "single") {
          document.querySelectorAll(".option-item").forEach((el) => el.classList.remove("checked"));
        }
        item.classList.toggle("checked", input.checked);
      });

      const keyHint = document.createElement("span");
      keyHint.className = "option-key";
      keyHint.textContent = idx < 9 ? String(idx + 1) : "";

      const labelSpan = document.createElement("span");
      labelSpan.className = "option-label";
      labelSpan.textContent = label;

      item.appendChild(input);
      if (keyHint.textContent) item.appendChild(keyHint);
      item.appendChild(labelSpan);
      optionsEl.appendChild(item);
    });
  } else {
    optionsEl.classList.remove("show");
  }

  // Text input visibility
  if (tab.allowText) {
    answerInput.classList.remove("hidden");
    answerInput.placeholder = tab.options.length > 0 ? "Optional note..." : "Type your response...";
    answerInput.value = tab.draftText || "";
    setTimeout(() => answerInput.focus(), 0);
  } else {
    answerInput.classList.add("hidden");
    answerInput.value = "";
  }

  renderTabBar();
}

function switchTo(id) {
  if (id === activeId) return;
  captureDraft();
  activeId = id;
  renderActiveTab();
}

function collectResponse() {
  const tab = tabs.get(activeId);
  if (!tab) return null;
  const text = answerInput.value.trim();

  if (!tab.options || tab.options.length === 0) {
    return { answered: true, response: text };
  }

  const checked = Array.from(optionsEl.querySelectorAll("input:checked")).map((i) => i.value);
  let response = "";
  if (checked.length > 0) {
    response = tab.selectionMode === "single"
      ? `Selected: ${checked[0]}`
      : `Selected: ${checked.join(", ")}`;
  }
  if (text) {
    response = response ? `${response} | Note: ${text}` : `Note: ${text}`;
  }
  if (!response) {
    response = "(no selection or text)";
  }
  return { answered: true, response };
}

function sendResponse(id, payload) {
  if (!tabs.has(id)) return;
  ipcRenderer.send("tab-response", { id, ...payload });
  tabs.delete(id);
  if (activeId === id) {
    activeId = tabs.size > 0 ? tabs.keys().next().value : null;
  }
  if (activeId) {
    renderActiveTab();
  } else {
    renderTabBar();
  }
  updateTabCount();
}

ipcRenderer.on("tab-added", (_event, data) => {
  const id = data.id;
  if (!id) return;
  // Initialize muted state from the daemon (relevant on first tab).
  if (typeof data.muted === "boolean" && tabs.size === 0) {
    setMuted(data.muted);
  }

  const wasEmpty = tabs.size === 0;
  tabs.set(id, {
    title: data.title || "Notification",
    message: data.message || "",
    options: Array.isArray(data.options) ? data.options : [],
    selectionMode: data.selectionMode === "single" ? "single" : "multiple",
    allowText:
      typeof data.allowText === "boolean"
        ? data.allowText
        : !(Array.isArray(data.options) && data.options.length > 0),
    draftText: "",
    draftSelections: new Set(),
    unread: !wasEmpty, // first tab gets focused; subsequent ones flag unread
  });

  if (wasEmpty || activeId === null) {
    activeId = id;
    renderActiveTab();
  } else {
    renderTabBar();
  }

  updateTabCount();
  startRinging();
});

answerBtn.addEventListener("click", () => {
  if (!activeId) return;
  const payload = collectResponse();
  if (payload) sendResponse(activeId, payload);
});

dismissBtn.addEventListener("click", () => {
  if (!activeId) return;
  sendResponse(activeId, { answered: false, response: "" });
});

answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!activeId) return;
    const payload = collectResponse();
    if (payload) sendResponse(activeId, payload);
  }
});

muteBtn.addEventListener("click", () => {
  setMuted(!muted);
});

dismissAllBtn.addEventListener("click", () => {
  ipcRenderer.send("dismiss-all");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (activeId) sendResponse(activeId, { answered: false, response: "" });
    return;
  }

  if (e.target === answerInput) return;

  if (e.key === "Enter") {
    e.preventDefault();
    if (!activeId) return;
    const payload = collectResponse();
    if (payload) sendResponse(activeId, payload);
    return;
  }

  // Tab / Shift+Tab to cycle tabs
  if (e.key === "Tab" && tabs.size > 1) {
    e.preventDefault();
    const ids = Array.from(tabs.keys());
    const i = ids.indexOf(activeId);
    const next = e.shiftKey
      ? ids[(i - 1 + ids.length) % ids.length]
      : ids[(i + 1) % ids.length];
    switchTo(next);
    return;
  }

  // Ctrl+M toggles mute
  if ((e.key === "m" || e.key === "M") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setMuted(!muted);
    return;
  }

  // Number key 1-9 toggles option in active tab
  const tab = activeId ? tabs.get(activeId) : null;
  if (tab && tab.options.length > 0 && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= tab.options.length) return;
    const input = document.getElementById(`opt-${idx}`);
    if (!input) return;
    e.preventDefault();
    if (tab.selectionMode === "single") {
      document.querySelectorAll(".option-item").forEach((el) => el.classList.remove("checked"));
      input.checked = true;
      input.parentElement.classList.add("checked");
    } else {
      input.checked = !input.checked;
      input.parentElement.classList.toggle("checked", input.checked);
    }
  }
});

updateTabCount();
