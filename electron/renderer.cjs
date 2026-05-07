const { ipcRenderer } = require("electron");

const titleEl = document.getElementById("title");
const messageEl = document.getElementById("message");
const answerBtn = document.getElementById("answerBtn");
const dismissBtn = document.getElementById("dismissBtn");
const answerInput = document.getElementById("answerInput");
const countdownEl = document.getElementById("countdown");

let audioContext = null;
let audioFailed = false;
let isRinging = false;
let ringInterval = null;
let countdownInterval = null;
let sent = false;

function createRingSound() {
  if (audioFailed) return;
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

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(830, now);
    oscillator.type = "sine";
    gainNode.gain.setValueAtTime(0.3, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    oscillator.start(now);
    oscillator.stop(now + 0.5);

    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.frequency.setValueAtTime(1660, now);
    osc2.type = "sine";
    gain2.gain.setValueAtTime(0.15, now);
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc2.start(now);
    osc2.stop(now + 0.3);
  } catch (err) {
    audioFailed = true;
    console.error("Audio error:", err);
    stopRinging();
  }
}

function startRinging() {
  if (isRinging) return;
  isRinging = true;
  createRingSound();
  ringInterval = setInterval(() => {
    if (isRinging) createRingSound();
  }, 1200);
}

function stopRinging() {
  isRinging = false;
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

function startCountdown(timeoutMs) {
  if (!countdownEl || !timeoutMs || timeoutMs <= 0) return;
  let remaining = Math.floor(timeoutMs / 1000);
  const render = () => {
    if (remaining <= 0) {
      countdownEl.textContent = "Auto-dismissing…";
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      return;
    }
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    const minPart = m > 0 ? `${m}m ` : "";
    const secPart = `${s.toString().padStart(2, "0")}s`;
    countdownEl.textContent = `Auto-dismiss in ${minPart}${secPart}`;
    remaining -= 1;
  };
  render();
  countdownInterval = setInterval(render, 1000);
}

function send(payload) {
  if (sent) return;
  sent = true;
  stopRinging();
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  ipcRenderer.send("user-response", payload);
}

ipcRenderer.on("notification-data", (_event, data) => {
  titleEl.textContent = (data && data.title) || "Notification";
  messageEl.textContent = (data && data.message) || "";
  startRinging();
  startCountdown(data && data.timeoutMs);
  if (answerInput) answerInput.focus();
});

answerBtn.addEventListener("click", () => {
  send({ answered: true, response: answerInput.value.trim() });
});

dismissBtn.addEventListener("click", () => {
  send({ answered: false, response: "" });
});

answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    send({ answered: true, response: answerInput.value.trim() });
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    send({ answered: false, response: "" });
  }
});
