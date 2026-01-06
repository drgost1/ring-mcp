#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for terminal output
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
  const home = homedir();
  return join(home, ".claude.json");
}

function getPackageRoot() {
  // Go up from bin/ to package root
  return join(__dirname, "..");
}

function setup() {
  log("\n🔔 Ring MCP Setup", colors.bright + colors.cyan);
  log("═".repeat(40), colors.cyan);

  const configPath = getClaudeConfigPath();
  const packageRoot = getPackageRoot();
  const serverPath = join(packageRoot, "dist", "index.js");

  log(`\n📁 Package location: ${packageRoot}`, colors.blue);
  log(`📁 Config location: ${configPath}`, colors.blue);

  // Check if server file exists
  if (!existsSync(serverPath)) {
    log("\n⚠️  Server not built yet. Building...", colors.yellow);
    const { execSync } = await import("child_process");
    try {
      execSync("npm run build", { cwd: packageRoot, stdio: "inherit" });
    } catch (err) {
      log("\n❌ Build failed. Please run 'npm run build' manually.", colors.red);
      process.exit(1);
    }
  }

  // Read existing config or create new one
  let config = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf8");
      config = JSON.parse(content);
      log("\n✓ Found existing Claude config", colors.green);
    } catch (err) {
      log("\n⚠️  Could not parse existing config, creating backup...", colors.yellow);
      writeFileSync(`${configPath}.backup`, readFileSync(configPath));
    }
  } else {
    log("\n📝 Creating new Claude config...", colors.yellow);
  }

  // Ensure mcpServers object exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Check if ring is already configured
  if (config.mcpServers.ring) {
    log("\n⚠️  Ring MCP is already configured!", colors.yellow);
    log("   Current path: " + (config.mcpServers.ring.args?.[0] || "unknown"));

    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question("\n   Overwrite existing configuration? (y/N): ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== "y") {
      log("\n   Keeping existing configuration.", colors.blue);
      log("\n✅ Setup complete! Restart Claude Code to use Ring MCP.\n", colors.green);
      return;
    }
  }

  // Add ring MCP server configuration
  config.mcpServers.ring = {
    type: "stdio",
    command: "node",
    args: [serverPath.replace(/\\/g, "/")], // Use forward slashes for cross-platform
    env: {},
  };

  // Write updated config
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    log("\n✅ Ring MCP configured successfully!", colors.green);
  } catch (err) {
    log(`\n❌ Failed to write config: ${err.message}`, colors.red);
    process.exit(1);
  }

  // Print success message
  log("\n" + "═".repeat(40), colors.cyan);
  log("\n🎉 Setup Complete!", colors.bright + colors.green);
  log("\nNext steps:", colors.bright);
  log("  1. Restart Claude Code", colors.reset);
  log("  2. The 'ring' tool will be available automatically", colors.reset);
  log("\nUsage in Claude Code:", colors.bright);
  log('  ring({ title: "Done!", message: "Task completed" })', colors.cyan);
  log("\nThe notification will pop up and you can respond!\n", colors.reset);
}

// Run setup
setup().catch((err) => {
  log(`\n❌ Setup failed: ${err.message}`, colors.red);
  process.exit(1);
});
