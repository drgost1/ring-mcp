# Ring MCP

An MCP (Model Context Protocol) server for Claude Code that shows **always-on-top notification popups** with sound when tasks complete.

Never miss when Claude finishes a task again!

![Ring Notification](https://via.placeholder.com/400x250/1a1a2e/e94560?text=Ring+Notification)

## Features

- **Always-on-top popup** - Notification appears above all windows
- **Bell sound** - Pleasant ring tone that repeats until dismissed
- **Interactive responses** - Type a response that Claude receives
- **Cross-platform** - Works on Windows, macOS, and Linux
- **One-click setup** - Automatic Claude Code configuration

## Quick Install

### Option 1: npx (Recommended)

```bash
npx ring-mcp-setup
```

### Option 2: Global Install

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

Once installed, Claude Code will automatically have access to the `ring` tool. Claude will use it intelligently to notify you when:

- A build or compilation finishes
- Tests complete (pass or fail)
- A feature implementation is done
- An error needs your attention
- User input is required to continue

### Manual Usage

You can also ask Claude to use it directly:

```
"Use the ring tool to notify me when you're done"
```

### Example Tool Call

```javascript
ring({
  title: "Build Complete",
  message: "The project compiled successfully. Ready for testing?"
})
```

## How It Works

1. **Claude calls the ring tool** with a title and message
2. **Electron popup appears** on top of all windows
3. **Bell sound plays** repeatedly to get your attention
4. **You respond** by typing in the text field and clicking "Answer"
5. **Claude receives your response** and continues accordingly

## Configuration

The setup script automatically adds the ring server to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "ring": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/ring-mcp/dist/index.js"]
    }
  }
}
```

### Making Claude Use It Automatically

Add to your project's `CLAUDE.md` or `~/.claude/CLAUDE.md`:

```markdown
## Notification Behavior

When you complete a significant task, use the `ring` tool to notify the user.
Use it for: builds, tests, deployments, feature completions, or when you need input.
Don't use it for: simple Q&A, quick edits, or rapid back-and-forth chat.
```

## Keyboard Shortcuts

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

1. Check if Electron is installed: `npx electron --version`
2. Rebuild the package: `cd /path/to/ring-mcp && npm run build`

### Sound not playing

The ring uses Web Audio API. If no sound plays:
- Check your system volume
- Some systems may block audio from Electron apps

## Development

```bash
# Clone the repo
git clone https://github.com/drgost1/ring-mcp.git
cd ring-mcp

# Install dependencies
npm install

# Build
npm run build

# Test the notification manually
npx electron electron/main.cjs "Test" "Hello World"
```

## Tech Stack

- **TypeScript** - MCP server
- **Electron** - Desktop notification UI
- **Web Audio API** - Sound generation
- **Model Context Protocol SDK** - Claude Code integration

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.

---

Made with Claude Code
