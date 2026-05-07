#!/usr/bin/env node

import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "index.js");

if (existsSync(distEntry)) {
  process.exit(0);
}

// Spawn tsc via Node directly. Avoids the Windows EINVAL issue with .cmd
// shims on Node 20+ (CVE-2024-27980), and works without `shell: true`.
const tscEntry = join(root, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tscEntry)) {
  console.warn(
    "[ring-mcp] TypeScript not installed (devDependency missing) — skipping postinstall build. The server will rebuild on first run if devDependencies are added."
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, [tscEntry], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0 || !existsSync(distEntry)) {
  console.warn(
    `[ring-mcp] Build failed during postinstall (exit ${result.status ?? "?"}) — the server will retry on first run.`
  );
}

// Never fail the install on a missing build.
process.exit(0);
