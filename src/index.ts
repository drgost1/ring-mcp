#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn, exec } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { tmpdir, platform } from "os";
import { randomUUID } from "crypto";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_DIR = join(__dirname, "..");
const PACKAGE_VERSION = "1.3.0";
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
// Default 0 = no timeout. User explicitly requested manual handling of all rings.
const ENV_TIMEOUT = parseInt(process.env.RING_TIMEOUT_MS ?? "", 10);
const DEFAULT_TIMEOUT_MS =
  Number.isFinite(ENV_TIMEOUT) && ENV_TIMEOUT >= 1000
    ? Math.min(ENV_TIMEOUT, MAX_TIMEOUT_MS)
    : 0;

const RING_HOME = join(tmpdir(), "ring-mcp");
const REQUESTS_DIR = join(RING_HOME, "requests");
const RESPONSES_DIR = join(RING_HOME, "responses");
const DAEMON_LOCK = join(RING_HOME, "daemon.pid");
const POLL_INTERVAL_MS = 250;

const execAsync = promisify(exec);

interface RingResponse {
  answered: boolean;
  response: string;
  error?: string;
  timedOut?: boolean;
}

interface PopupOptions {
  title: string;
  message: string;
  timeoutMs: number;
  options: string[];
  selectionMode: "single" | "multiple";
  allowText: boolean;
}

const server = new Server(
  { name: "ring-mcp", version: PACKAGE_VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ring",
      description:
        "Ring a notification bell that opens a tab in a single always-on-top popup window. Multiple concurrent rings appear as tabs in the same window — the user switches between them and answers each independently. Each tab supports a free-form text reply, multi/single-select options (1-9 keys to toggle, Enter to submit, Esc to dismiss), or both. There is no auto-dismiss by default; the popup waits for the user. The user can also Mute the bell or Dismiss All from the toolbar. If the popup cannot be shown, the server falls back to an OS-native notification and reports the failure.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Notification title (max 200 chars)",
            maxLength: 200,
          },
          message: {
            type: "string",
            description: "Notification body (max 5000 chars)",
            maxLength: 5000,
          },
          options: {
            type: "array",
            description:
              "Optional list of choices. When provided, the tab renders checkboxes (or radios in 'single' selectionMode) instead of just a text field. Up to 12 items, each up to 200 chars.",
            items: { type: "string", maxLength: 200 },
            maxItems: 12,
          },
          selectionMode: {
            type: "string",
            enum: ["single", "multiple"],
            description:
              "How options behave: 'single' = radio buttons, 'multiple' = checkboxes. Default 'multiple'. Ignored when no options are provided.",
          },
          allowText: {
            type: "boolean",
            description:
              "When options are provided, also show the free-form text input alongside them. Default: false when options are provided, true when no options.",
          },
          timeoutMs: {
            type: "number",
            description:
              "Optional auto-dismiss timeout in milliseconds (1000–3600000). Default 0 = wait forever (the user explicitly handles each ring manually).",
            minimum: 0,
            maximum: MAX_TIMEOUT_MS,
          },
        },
        required: ["title", "message"],
      },
    },
  ],
}));

async function locateElectron(): Promise<string | null> {
  try {
    const mod: unknown = await import("electron");
    const candidate =
      (mod as { default?: unknown }).default ??
      (typeof mod === "string" ? mod : undefined);
    if (typeof candidate === "string" && existsSync(candidate)) {
      return candidate;
    }
  } catch {
    /* fall through */
  }

  const isWin = platform() === "win32";
  const fallbacks = [
    join(PROJECT_DIR, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron"),
    join(PROJECT_DIR, "node_modules", ".bin", isWin ? "electron.cmd" : "electron"),
  ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function nativeNotify(title: string, message: string): Promise<boolean> {
  const safeTitle = title.replace(/['"`$\r\n]/g, " ").slice(0, 120);
  const safeMessage = message.replace(/['"`$\r\n]/g, " ").slice(0, 250);

  try {
    if (platform() === "win32") {
      const ps =
        `Add-Type -AssemblyName System.Windows.Forms;` +
        `$n = New-Object System.Windows.Forms.NotifyIcon;` +
        `$n.Icon = [System.Drawing.SystemIcons]::Information;` +
        `$n.Visible = $true;` +
        `$n.ShowBalloonTip(5000, '${safeTitle}', '${safeMessage}', [System.Windows.Forms.ToolTipIcon]::Info);` +
        `Start-Sleep -Seconds 6;` +
        `$n.Dispose()`;
      await execAsync(
        `powershell -NoProfile -WindowStyle Hidden -Command "${ps.replace(/"/g, '\\"')}"`,
        { windowsHide: true, timeout: 10000 }
      );
      return true;
    }
    if (platform() === "darwin") {
      await execAsync(
        `osascript -e 'display notification "${safeMessage}" with title "${safeTitle}"'`,
        { timeout: 5000 }
      );
      return true;
    }
    await execAsync(`notify-send "${safeTitle}" "${safeMessage}"`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function ensureRingDirs(): void {
  for (const d of [RING_HOME, REQUESTS_DIR, RESPONSES_DIR]) {
    try {
      mkdirSync(d, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDaemonPid(): number {
  try {
    return parseInt(readFileSync(DAEMON_LOCK, "utf8").trim(), 10);
  } catch {
    return 0;
  }
}

function ensureDaemonRunning(electronPath: string, mainPath: string): boolean {
  ensureRingDirs();

  // Fast path: existing alive daemon.
  if (existsSync(DAEMON_LOCK) && isPidAlive(readDaemonPid())) {
    return true;
  }

  // Stale lock: try to remove. If somebody just claimed it between our
  // check and remove, that's fine — they'll be the daemon.
  try {
    unlinkSync(DAEMON_LOCK);
  } catch {
    /* ignore */
  }

  // Spawn detached daemon. We write the lock with the spawned child's PID.
  let child;
  try {
    child = spawn(electronPath, [mainPath, "--daemon"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    return false;
  }

  try {
    writeFileSync(DAEMON_LOCK, String(child.pid), "utf8");
  } catch {
    /* if we couldn't write the lock, daemon will rewrite it on boot */
  }
  child.unref();
  return true;
}

async function showPopup(opts: PopupOptions): Promise<RingResponse> {
  const electronPath = await locateElectron();
  if (!electronPath) {
    return {
      answered: false,
      response: "",
      error: "Electron binary not found — run `npm install` inside ring-mcp",
    };
  }

  const mainPath = join(PROJECT_DIR, "electron", "main.cjs");
  if (!existsSync(mainPath)) {
    return {
      answered: false,
      response: "",
      error: `Electron entry missing at ${mainPath}`,
    };
  }

  ensureRingDirs();

  const id = randomUUID();
  const requestPath = join(REQUESTS_DIR, `${id}.json`);
  const responsePath = join(RESPONSES_DIR, `${id}.json`);

  // Atomic write so the daemon never reads a half-written request.
  const requestBody = JSON.stringify({
    id,
    title: opts.title,
    message: opts.message,
    options: opts.options,
    selectionMode: opts.selectionMode,
    allowText: opts.allowText,
    createdAt: Date.now(),
  });
  try {
    const tmp = `${requestPath}.tmp`;
    writeFileSync(tmp, requestBody, "utf8");
    renameSync(tmp, requestPath);
  } catch (err) {
    return {
      answered: false,
      response: "",
      error: `Failed to write request file: ${(err as Error).message}`,
    };
  }

  const daemonOk = ensureDaemonRunning(electronPath, mainPath);
  if (!daemonOk) {
    try {
      unlinkSync(requestPath);
    } catch {
      /* ignore */
    }
    return {
      answered: false,
      response: "",
      error: "Failed to start the ring daemon",
    };
  }

  return await waitForResponse(responsePath, opts.timeoutMs);
}

function waitForResponse(responsePath: string, timeoutMs: number): Promise<RingResponse> {
  return new Promise<RingResponse>((resolve) => {
    let settled = false;
    let pollHandle: NodeJS.Timeout | null = null;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let watchdogHandle: NodeJS.Timeout | null = null;

    const finish = (value: RingResponse): void => {
      if (settled) return;
      settled = true;
      if (pollHandle) clearInterval(pollHandle);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (watchdogHandle) clearInterval(watchdogHandle);
      try {
        if (existsSync(responsePath)) unlinkSync(responsePath);
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const tryRead = (): boolean => {
      try {
        if (!existsSync(responsePath)) return false;
        const raw = readFileSync(responsePath, "utf8");
        const parsed = JSON.parse(raw);
        finish({
          answered: Boolean(parsed.answered),
          response: typeof parsed.response === "string" ? parsed.response : "",
          error: typeof parsed.error === "string" ? parsed.error : undefined,
          timedOut: Boolean(parsed.timedOut),
        });
        return true;
      } catch {
        // mid-write — retry on next poll
        return false;
      }
    };

    pollHandle = setInterval(tryRead, POLL_INTERVAL_MS);
    tryRead();

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        finish({ answered: false, response: "", timedOut: true });
      }, timeoutMs);
    }

    // Watchdog: if the daemon dies while we wait, surface an error instead of
    // blocking forever.
    watchdogHandle = setInterval(() => {
      const pid = readDaemonPid();
      if (pid > 0 && !isPidAlive(pid)) {
        finish({
          answered: false,
          response: "",
          error: "Ring daemon exited while waiting for the user's response",
        });
      }
    }, 1500);
  });
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "ring") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = (request.params.arguments ?? {}) as {
    title?: unknown;
    message?: unknown;
    timeoutMs?: unknown;
    options?: unknown;
    selectionMode?: unknown;
    allowText?: unknown;
  };

  const title =
    typeof args.title === "string" && args.title.trim().length > 0
      ? args.title.slice(0, 200)
      : "Notification";
  const message =
    typeof args.message === "string" ? args.message.slice(0, 5000) : "";
  const timeoutMs =
    typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) && args.timeoutMs >= 1000
      ? Math.min(args.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

  const options = Array.isArray(args.options)
    ? args.options
        .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
        .slice(0, 12)
        .map((s) => s.slice(0, 200))
    : [];
  const selectionMode: "single" | "multiple" =
    args.selectionMode === "single" ? "single" : "multiple";
  const allowText =
    typeof args.allowText === "boolean"
      ? args.allowText
      : options.length === 0;

  if (process.env.RING_DISABLED === "1") {
    console.error(`[ring-mcp] disabled via RING_DISABLED — silently acknowledging "${title}"`);
    return {
      content: [
        {
          type: "text",
          text: `Ring disabled (RING_DISABLED=1). Title: ${title} | Message: ${message}`,
        },
      ],
    };
  }

  let result: RingResponse;
  try {
    result = await showPopup({
      title,
      message,
      timeoutMs,
      options,
      selectionMode,
      allowText,
    });
  } catch (err) {
    result = {
      answered: false,
      response: "",
      error: (err as Error).message,
    };
  }

  if (result.error && !result.answered) {
    console.error(`[ring-mcp] popup failed: ${result.error} — trying native notification`);
    const dispatched = await nativeNotify(title, message);
    const text = dispatched
      ? `Popup unavailable (${result.error}); shown via OS native notification instead. The user cannot reply through the fallback.`
      : `Popup unavailable (${result.error}); native notification also failed. Title="${title}" Message="${message}" was logged to stderr.`;
    return { content: [{ type: "text", text }] };
  }

  if (result.timedOut) {
    return {
      content: [
        {
          type: "text",
          text: `Notification auto-dismissed after ${timeoutMs}ms with no response.`,
        },
      ],
    };
  }

  if (result.answered) {
    return {
      content: [
        {
          type: "text",
          text: `User answered: ${result.response || "(empty response)"}`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: "User dismissed the notification without answering." }],
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Ring MCP server v${PACKAGE_VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
