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
import { readFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir, platform } from "os";
import { randomUUID } from "crypto";
import { promisify } from "util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_DIR = join(__dirname, "..");
const PACKAGE_VERSION = "1.1.0";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const ENV_TIMEOUT = parseInt(process.env.RING_TIMEOUT_MS ?? "", 10);
const TIMEOUT_MS =
  Number.isFinite(ENV_TIMEOUT) && ENV_TIMEOUT >= 1000
    ? Math.min(ENV_TIMEOUT, MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS;

const execAsync = promisify(exec);

interface RingResponse {
  answered: boolean;
  response: string;
  error?: string;
  timedOut?: boolean;
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
        "Ring a notification bell with an always-on-top popup. The user can type a response and click 'Answer', or click 'Dismiss' to close without responding. Returns the user's response if they answered. If the popup cannot be shown, the server falls back to an OS-native notification (no response possible) and reports the failure reason.",
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
            description: "Notification body (max 2000 chars)",
            maxLength: 2000,
          },
          timeoutMs: {
            type: "number",
            description:
              "Optional auto-dismiss timeout in milliseconds (1000–3600000, default 300000)",
            minimum: 1000,
            maximum: MAX_TIMEOUT_MS,
          },
        },
        required: ["title", "message"],
      },
    },
  ],
}));

async function locateElectron(): Promise<string | null> {
  // Preferred: the `electron` package exports its binary path when imported from plain Node.
  try {
    const mod: unknown = await import("electron");
    const candidate =
      (mod as { default?: unknown }).default ??
      (typeof mod === "string" ? mod : undefined);
    if (typeof candidate === "string" && existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // fall through to disk fallbacks
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

async function showPopup(
  title: string,
  message: string,
  timeoutMs: number
): Promise<RingResponse> {
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

  const responseFilePath = join(tmpdir(), `ring-mcp-${randomUUID()}.json`);

  return new Promise<RingResponse>((resolve) => {
    let settled = false;
    const finish = (value: RingResponse): void => {
      if (settled) return;
      settled = true;
      try {
        if (existsSync(responseFilePath)) unlinkSync(responseFilePath);
      } catch {
        /* ignore cleanup errors */
      }
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(electronPath, [mainPath, "--ring-from-env"], {
        stdio: "ignore",
        cwd: PROJECT_DIR,
        env: {
          ...process.env,
          RING_TITLE: title,
          RING_MESSAGE: message,
          RING_RESPONSE_PATH: responseFilePath,
          RING_TIMEOUT_MS: String(timeoutMs),
        },
        windowsHide: true,
      });
    } catch (err) {
      finish({
        answered: false,
        response: "",
        error: `Failed to spawn Electron: ${(err as Error).message}`,
      });
      return;
    }

    // Hard kill if the popup process outlives its own timeout (grace = +5s).
    const killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({ answered: false, response: "", timedOut: true });
    }, timeoutMs + 5000);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      finish({
        answered: false,
        response: "",
        error: `Electron spawn error: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      try {
        if (existsSync(responseFilePath)) {
          const raw = readFileSync(responseFilePath, "utf8");
          const parsed = JSON.parse(raw);
          finish({
            answered: Boolean(parsed.answered),
            response: typeof parsed.response === "string" ? parsed.response : "",
            error: typeof parsed.error === "string" ? parsed.error : undefined,
            timedOut: Boolean(parsed.timedOut),
          });
        } else {
          finish({
            answered: false,
            response: "",
            error: `Electron exited (code ${code ?? "unknown"}) without writing a response`,
          });
        }
      } catch (err) {
        finish({
          answered: false,
          response: "",
          error: `Could not read response: ${(err as Error).message}`,
        });
      }
    });
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
  };

  const title =
    typeof args.title === "string" && args.title.trim().length > 0
      ? args.title.slice(0, 200)
      : "Notification";
  const message =
    typeof args.message === "string" ? args.message.slice(0, 2000) : "";
  const timeoutMs =
    typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs) && args.timeoutMs >= 1000
      ? Math.min(args.timeoutMs, MAX_TIMEOUT_MS)
      : TIMEOUT_MS;

  // Hard kill switch — useful for headless / autonomous runs.
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
    result = await showPopup(title, message, timeoutMs);
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
