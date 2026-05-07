# Ring MCP

An MCP (Model Context Protocol) server for Claude Code that shows **always-on-top notification popups** with sound when tasks complete — with a graceful OS-native notification fallback if the popup can't open.

Never miss when Claude finishes a task again!

## Features

- **Always-on-top popup** — appears above all windows (including fullscreen apps)
- **Bell sound** — pleasant ring tone that repeats until you respond
- **Interactive responses** — type a reply that Claude receives
- **Auto-dismiss timeout** — popup closes itself after a configurable timeout (default 5 min) so it never hangs forever
- **Native notification fallback** — if Electron can't launch (no display, missing binary, etc.), the server falls back to PowerShell toast (Windows), `osascript` (macOS), or `notify-send` (Linux), and reports the failure reason back to Claude
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

### Example tool call

```javascript
ring({
  title: "Build Complete",
  message: "The project compiled successfully. Ready for testing?",
  timeoutMs: 600000   // optional — auto-dismiss after 10 min
})
```

### Tool parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Title shown in the popup (max 200 chars) |
| `message` | string | yes | Body shown in the popup (max 2000 chars) |
| `timeoutMs` | number | no | Auto-dismiss timeout in ms (1000–3600000, default 300000) |

## How it works

1. **Claude calls the ring tool** with a title and message
2. **Electron popup appears** on top of all windows (including fullscreen)
3. **Bell sound plays** until you respond or the popup auto-dismisses
4. **You respond** by typing in the text field and clicking "Answer"
5. **Claude receives your response** and continues accordingly

If the Electron popup cannot launch (e.g. on a headless server, missing binary, or sandbox restriction), the server automatically falls back to an OS-native notification and tells Claude that no interactive response is possible.

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

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| **Enter** | Submit response |
| **Escape** | Dismiss without response |

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

# Test the popup directly
RING_TITLE="Test" RING_MESSAGE="Hello" RING_RESPONSE_PATH=/tmp/r.json RING_TIMEOUT_MS=15000 \
  npx electron electron/main.cjs --ring-from-env
cat /tmp/r.json
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
