# Ring MCP

An MCP (Model Context Protocol) server for Claude Code that shows **always-on-top notification popups** with sound when tasks complete — with a graceful OS-native notification fallback if the popup can't open.

Never miss when Claude finishes a task again!

## Features

- **One window, many tabs** — every concurrent ring (across sessions, MCP clients, anything) becomes a tab in the same always-on-top window. No popup spam, no overlapping cascades
- **Always-on-top** — wins over fullscreen apps via `screen-saver` window level; renders on the monitor your cursor is on
- **Bell sound + Mute toggle** — pleasant ring loops until you respond; click `🔊 Sound` (or `Ctrl+M`) to silence the bell while keeping the popup
- **Interactive responses** — type a free-form reply, pick from a list of options (checkboxes / radios), or both
- **Quick-pick keyboard** — `1`-`9` toggle options, `Enter` answer, `Esc` dismiss current tab, `Tab` / `Shift+Tab` cycle tabs
- **No timeout by default** — popups wait until you handle them manually. Opt-in `timeoutMs` if you want auto-dismiss
- **Dismiss-all** — one click in the toolbar resolves every pending tab as dismissed
- **Per-tab draft preservation** — switching tabs keeps your typed text + selections intact
- **Native notification fallback** — if Electron can't launch (no display, missing binary, etc.), falls back to PowerShell toast (Windows), `osascript` (macOS), or `notify-send` (Linux) and reports the failure reason back to Claude
- **Cross-platform** — Windows, macOS, Linux
- **One-click setup** — automatic Claude Code configuration with atomic config writes and timestamped backups

## Quick Install

### Option 1: npx (recommended)

```bash
npx ring-mcp-setup
```

### Option 2: Global install

```bash
npm install -g ring-mcp
ring-mcp-setup
```

### Option 3: Clone from GitHub

```bash
git clone https://github.com/drgost1/ring-mcp.git
cd ring-mcp
npm install
npm run setup
```

After installation, **restart Claude Code** to activate the ring tool.

## Usage

Once installed, Claude Code automatically has access to the `ring` tool. Claude will use it intelligently to notify you when:

- A build or compilation finishes
- Tests complete (pass or fail)
- A feature implementation is done
- An error needs your attention
- User input is required to continue

### Manual usage

You can also ask Claude to use it directly:

```
"Use the ring tool to notify me when you're done"
```

### Example tool calls

**Simple notification:**
```javascript
ring({
  title: "Build Complete",
  message: "The project compiled successfully. Ready for testing?"
})
```

**Multi-select checklist** — let the user pick several items in one click:
```javascript
ring({
  title: "Pick tasks to run now",
  message: "Which of these should I do this session?",
  options: [
    "Build YoPekka",
    "Deploy bangopower.com",
    "Fix shinbao login bug",
    "Review PRs",
    "Update dependencies"
  ]
  // selectionMode defaults to "multiple", allowText defaults to false when options are present
})
```

**Single-select with optional note:**
```javascript
ring({
  title: "Stack choice",
  message: "Which framework for the admin panel?",
  options: ["Livewire", "Plain Blade", "Inertia + Vue"],
  selectionMode: "single",
  allowText: true   // user can also leave a note
})
```

### Tool parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title shown in the tab (max 200 chars) |
| `message` | string | yes | Body shown in the tab (max 5000 chars) |
| `options` | string[] | no | If provided, the tab renders checkboxes / radios instead of plain text input. Up to 12 items, each up to 200 chars |
| `selectionMode` | `"single"` \| `"multiple"` | no | How options behave. Default `"multiple"` (checkboxes). Ignored without `options` |
| `allowText` | boolean | no | When `options` is set, also show the text input for a free-form note. Default: `false` with options, `true` without |
| `timeoutMs` | number | no | Auto-dismiss timeout in ms (1000–3600000). Default `0` = wait forever — the user explicitly handles each ring |

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit the active tab |
| `Esc` | Dismiss the active tab |
| `1`-`9` | Toggle the corresponding option |
| `Tab` / `Shift+Tab` | Cycle through open tabs |
| `Ctrl+M` / `⌘M` | Mute / unmute the bell |

### Response format

Plain text reply: `User answered: <text>`

Options selected: `User answered: Selected: opt1, opt3`

Options + text: `User answered: Selected: opt1, opt3 | Note: <text>`

Dismissed: `User dismissed the notification without answering.`

Timed out: `Notification auto-dismissed after <ms>ms with no response.`

## How it works

Ring uses a **shared daemon + tabs** model so multiple concurrent rings never spam your screen:

1. **Claude (or any MCP client) calls the ring tool** with a title, message, and optional `options`
2. **The MCP server writes a request file** to `<tmpdir>/ring-mcp/requests/<uuid>.json`
3. **A single Electron daemon** (started on first request, shared across every Claude Code session) picks the file up via `fs.watch` and **opens a new tab in the same always-on-top window**
4. **You answer or dismiss** — the daemon writes a response file to `<tmpdir>/ring-mcp/responses/<uuid>.json`
5. **Each MCP call resolves with its own response**, in whatever order you handled them
6. When all tabs are gone (or you click Dismiss-all / close the window), the daemon exits

If the Electron daemon cannot launch (no display, missing binary, sandbox restriction), the server falls back to an OS-native notification (PowerShell toast / `osascript` / `notify-send`) and reports the failure to Claude — the user can't reply through the fallback.

## Configuration

The setup script atomically updates `~/.claude.json`:

```json
{
  "mcpServers": {
    "ring": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/ring-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

If your existing `~/.claude.json` is already present, setup creates a timestamped backup (`.bak-<timestamp>`) before writing. If the existing file is malformed JSON, setup quarantines it as `.broken-<timestamp>.bak` and writes a fresh config instead of failing.

### Environment variables

You can tweak runtime behaviour without re-running setup by adding env vars to the `env` object in `~/.claude.json`:

| Variable | Effect |
|----------|--------|
| `RING_TIMEOUT_MS` | Default auto-dismiss timeout in ms (overrides the 5-minute default) |
| `RING_DISABLED=1` | Skip the popup entirely. The tool returns a stub response and logs to stderr — useful for headless `/loop` runs |

### Making Claude use it automatically

Add this to your project's `CLAUDE.md` or `~/.claude/CLAUDE.md`:

```markdown
## Notification Behavior

When you complete a significant task, use the `ring` tool to notify the user.
Use it for: builds, tests, deployments, feature completions, or when you need input.
Don't use it for: simple Q&A, quick edits, or rapid back-and-forth chat.
```

## Troubleshooting

### Ring tool not available

1. Run `claude mcp list` to check if the server is connected
2. If not listed, run `ring-mcp-setup` again
3. Restart Claude Code

### Notification not appearing

1. Check Electron is installed: `npx electron --version`
2. Rebuild: `cd /path/to/ring-mcp && npm run build`
3. Check Claude's stderr — the server logs the exact failure reason and whether the native notification fallback fired

### Electron crashes on launch (Windows)

The server already disables hardware acceleration and the GPU sandbox. If it still crashes, try `RING_DISABLED=1` to confirm the rest of the chain works, then look at the Electron stderr for the underlying GPU/sandbox error.

### Sound not playing

The ring uses the Web Audio API. If no sound plays:
- Check system volume
- Some systems block audio from headless / sandboxed Electron apps — the popup remains visible regardless

## Development

```bash
git clone https://github.com/drgost1/ring-mcp.git
cd ring-mcp
npm install
npm run build

# End-to-end test: 3 concurrent rings → one window with 3 tabs
printf '%s\n%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1.0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ring","arguments":{"title":"Tab #1","message":"Pick one","options":["A","B","C"],"selectionMode":"single"}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ring","arguments":{"title":"Tab #2","message":"Pick many","options":["X","Y","Z"]}}}' \
  '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"ring","arguments":{"title":"Tab #3","message":"Free text"}}}' \
  | node dist/index.js

# Direct daemon (skip MCP layer):
npx electron electron/main.cjs --ring-from-env  # legacy single-popup mode
npx electron electron/main.cjs --daemon         # daemon mode (drop request files into <tmp>/ring-mcp/requests/)
```

## Tech stack

- **TypeScript** — MCP server
- **Electron** — desktop notification UI
- **Web Audio API** — sound generation
- **Model Context Protocol SDK** — Claude Code integration

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

---

Made with Claude Code
