#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = new Server(
  {
    name: "ring-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "ring",
        description:
          "Ring a notification bell with an always-on-top popup. The user can type a response and click 'Answer', or click 'Dismiss' to close without responding. Returns the user's response if they answered.",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The title of the notification (e.g., 'Task Complete')",
            },
            message: {
              type: "string",
              description: "The message to display (e.g., 'Your build has finished successfully!')",
            },
          },
          required: ["title", "message"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "ring") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { title, message } = request.params.arguments as {
    title: string;
    message: string;
  };

  // Use project directory for response file (more reliable on Windows)
  const projectDir = join(__dirname, "..");
  const responseFilePath = join(projectDir, `ring-response-${randomUUID()}.json`);

  // Path to electron executable and main.cjs
  const electronPath = join(projectDir, "node_modules", ".bin", "electron.cmd");
  const mainPath = join(projectDir, "electron", "main.cjs");

  // Spawn the Electron notification window and wait for it to close
  return new Promise((resolve, reject) => {
    // On Windows, .cmd files require shell: true
    const electronProcess = spawn(
      `"${electronPath}"`,
      [`"${mainPath}"`, `"${title}"`, `"${message}"`, `"${responseFilePath}"`],
      {
        stdio: "ignore",
        shell: true,
        cwd: projectDir,
      }
    );

    electronProcess.on("close", () => {
      try {
        // Read the response file
        let userResponse = { answered: false, response: "" };

        if (existsSync(responseFilePath)) {
          const content = readFileSync(responseFilePath, "utf8");
          userResponse = JSON.parse(content);

          // Clean up temp file
          try {
            unlinkSync(responseFilePath);
          } catch {
            // Ignore cleanup errors
          }
        }

        if (userResponse.answered) {
          resolve({
            content: [
              {
                type: "text",
                text: `User answered: ${userResponse.response || "(empty response)"}`,
              },
            ],
          });
        } else {
          resolve({
            content: [
              {
                type: "text",
                text: "User dismissed the notification without answering.",
              },
            ],
          });
        }
      } catch (err) {
        resolve({
          content: [
            {
              type: "text",
              text: `Notification closed. Could not read response: ${err}`,
            },
          ],
        });
      }
    });

    electronProcess.on("error", (err) => {
      reject(new Error(`Failed to spawn notification: ${err.message}`));
    });
  });
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Ring MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
