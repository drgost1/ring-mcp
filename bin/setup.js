#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createInterface } from "readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function getClaudeConfigPath() {
  return join(homedir(), ".claude.json");
}

function getPackageRoot() {
  return join(__dirname, "..");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function buildIfNeeded(packageRoot, serverPath) {
  if (existsSync(serverPath)) return true;
  log("\n⚠️  Server not built yet. Building...", colors.yellow);
  // Spawn tsc directly via Node so we don't hit the Windows .cmd EINVAL issue
  // on Node 20+ (CVE-2024-27980) and don't need shell: true.
  const tscEntry = join(packageRoot, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscEntry)) {
    log(
      "\n❌ TypeScript not installed. Run `npm install` inside ring-mcp first.",
      colors.red
    );
    return false;
  }
  const result = spawnSync(process.execPath, [tscEntry], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.status !== 0 || !existsSync(serverPath)) {
    log("\n❌ Build failed. Run `npm install && npm run build` inside ring-mcp manually.", colors.red);
    return false;
  }
  return true;
}

function readExistingConfig(configPath) {
  if (!existsSync(configPath)) {
    return { config: {}, isNew: true };
  }
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return { config: parsed && typeof parsed === "object" ? parsed : {}, isNew: false };
  } catch (err) {
    const backup = `${configPath}.broken-${timestamp()}.bak`;
    log(
      `\n⚠️  Existing config is not valid JSON. Backed up to ${backup} and starting fresh.`,
      colors.yellow
    );
    try {
      copyFileSync(configPath, backup);
    } catch (copyErr) {
      log(`   (Backup also failed: ${copyErr.message})`, colors.red);
    }
    return { config: {}, isNew: true, recoveredFromCorruption: true };
  }
}

function writeConfigAtomic(configPath, config) {
  const serialized = JSON.stringify(config, null, 2);
  // Roundtrip check before touching the real file.
  JSON.parse(serialized);
  const tmp = `${configPath}.tmp-${process.pid}`;
  writeFileSync(tmp, serialized, "utf8");
  renameSync(tmp, configPath);
}

async function setup() {
  log("\n🔔 Ring MCP Setup", colors.bright + colors.cyan);
  log("═".repeat(40), colors.cyan);

  const configPath = getClaudeConfigPath();
  const packageRoot = getPackageRoot();
  const serverPath = join(packageRoot, "dist", "index.js");

  log(`\n📁 Package location: ${packageRoot}`, colors.blue);
  log(`📁 Config location: ${configPath}`, colors.blue);

  if (!buildIfNeeded(packageRoot, serverPath)) {
    process.exit(1);
  }

  const { config, isNew } = readExistingConfig(configPath);
  if (isNew) {
    log("\n📝 Creating new Claude config...", colors.yellow);
  } else {
    log("\n✓ Found existing Claude config", colors.green);
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  if (config.mcpServers.ring) {
    log("\n⚠️  Ring MCP is already configured!", colors.yellow);
    const currentArgs = config.mcpServers.ring.args;
    if (Array.isArray(currentArgs) && currentArgs[0]) {
      log(`   Current path: ${currentArgs[0]}`);
    }
    const answer = await ask("\n   Overwrite existing configuration? (y/N): ");
    if (answer.trim().toLowerCase() !== "y") {
      log("\n   Keeping existing configuration.", colors.blue);
      log("\n✅ Setup complete! Restart Claude Code to use Ring MCP.\n", colors.green);
      return;
    }
  }

  // Backup the existing config before overwriting (if present and parseable).
  if (!isNew && existsSync(configPath)) {
    const backup = `${configPath}.bak-${timestamp()}`;
    try {
      copyFileSync(configPath, backup);
      log(`\n💾 Backed up existing config to ${backup}`, colors.blue);
    } catch (err) {
      log(`\n⚠️  Could not back up config: ${err.message}`, colors.yellow);
    }
  }

  config.mcpServers.ring = {
    type: "stdio",
    command: "node",
    args: [serverPath.replace(/\\/g, "/")],
    env: {},
  };

  try {
    writeConfigAtomic(configPath, config);
    log("\n✅ Ring MCP configured successfully!", colors.green);
  } catch (err) {
    log(`\n❌ Failed to write config: ${err.message}`, colors.red);
    process.exit(1);
  }

  log("\n" + "═".repeat(40), colors.cyan);
  log("\n🎉 Setup Complete!", colors.bright + colors.green);
  log("\nNext steps:", colors.bright);
  log("  1. Restart Claude Code", colors.reset);
  log("  2. The 'ring' tool will be available automatically", colors.reset);
  log("\nUsage in Claude Code:", colors.bright);
  log('  ring({ title: "Done!", message: "Task completed" })', colors.cyan);
  log("\nOptional env vars:", colors.bright);
  log("  RING_TIMEOUT_MS  — default auto-dismiss timeout (default 300000)", colors.reset);
  log("  RING_DISABLED=1  — silence the ring (logs to stderr instead of opening a popup)", colors.reset);
  log("");
}

setup().catch((err) => {
  log(`\n❌ Setup failed: ${err.message}`, colors.red);
  process.exit(1);
});
