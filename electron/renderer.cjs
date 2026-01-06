const { ipcRenderer } = require("electron");

const titleEl = document.getElementById("title");
const messageEl = document.getElementById("message");
const answerBtn = document.getElementById("answerBtn");
const dismissBtn = document.getElementById("dismissBtn");
const answerInput = document.getElementById("answerInput");

let audioContext = null;
let isRinging = false;
let ringInterval = null;

// Create a pleasant bell-like ring sound using Web Audio API
function createRingSound() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }

  const now = audioContext.currentTime;

  // Create oscillator for the main tone
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  // Bell-like frequency
  oscillator.frequency.setValueAtTime(830, now);
  oscillator.type = "sine";

  // Envelope for bell-like decay
  gainNode.gain.setValueAtTime(0.3, now);
  gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

  oscillator.start(now);
  oscillator.stop(now + 0.5);

  // Second harmonic for richness
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
}

function startRinging() {
  isRinging = true;
  createRingSound();
  ringInterval = setInterval(() => {
    if (isRinging) {
      createRingSound();
    }
  }, 1200);
}

function stopRinging() {
  isRinging = false;
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

// Receive notification data from main process
ipcRenderer.on("notification-data", (event, data) => {
  titleEl.textContent = data.title;
  messageEl.textContent = data.message;
  startRinging();
  answerInput.focus();
});

// Answer button - send response and close
answerBtn.addEventListener("click", () => {
  const response = answerInput.value.trim();
  stopRinging();
  ipcRenderer.send("user-response", { answered: true, response: response });
});

// Dismiss button - close without response
dismissBtn.addEventListener("click", () => {
  stopRinging();
  ipcRenderer.send("user-response", { answered: false, response: "" });
});

// Enter key submits answer
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const response = answerInput.value.trim();
    stopRinging();
    ipcRenderer.send("user-response", { answered: true, response: response });
  }
});

// Escape key dismisses
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    stopRinging();
    ipcRenderer.send("user-response", { answered: false, response: "" });
  }
});
