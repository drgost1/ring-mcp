#!/usr/bin/env node

import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distEntry = join(root, "dist", "index.js");

if (!existsSync(distEntry)) {
  console.error("[ring-mcp] dist not found, attempting auto-build...");
  const tscEntry = join(root, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscEntry)) {
    console.error(
      "[ring-mcp] TypeScript missing. Run `npm install` (with devDependencies) inside the ring-mcp folder, then retry."
    );
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [tscEntry], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0 || !existsSync(distEntry)) {
    console.error(
      "[ring-mcp] Auto-build failed. Run `npm install && npm run build` inside the ring-mcp folder, then retry."
    );
    process.exit(1);
  }
}

await import(pathToFileURL(distEntry).href);
