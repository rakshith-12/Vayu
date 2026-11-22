# TrueForge VS Code Coding Agent

An editor-native VS Code coding agent whose entire agent execution loop, tool orchestration, subagent spawning, context compaction, and model routing run on [@truefoundry/trueforge](https://github.com/truefoundry/trueforge) in local mode (`http://127.0.0.1:3000`).

## Architecture

- **Extension Host**: TypeScript VS Code extension with embedded MCP server (`src/mcp/server.ts`)
- **TrueForge Integration**: All LLM inference routed through TrueForge local server via SSE streams (`src/trueforge/client.ts`)
- **Dual-Mode Context Engine**: Mode 1 (Inline Edit fast-path) and Mode 2 (Agent Mode)
- **Two-Phase Diff Pipeline**: Shadow LSP verification → Line-level highlights & CodeLens review → Bottom-to-top WorkspaceEdit apply → Turn checkpoint undo
- **Bundled Webview**: Custom reactive UI panel in the activity bar with live Context Ledger token tracking and Diff Review drawer

## Quick Start

### 1. Prerequisites

- **Node.js**: >= 22.14 (Node.js LTS v26.13.1 is installed on this system)
- **VS Code**: >= 1.85.0
- **TrueForge**: Installed globally via `@truefoundry/trueforge`

### 2. Start TrueForge Local Server

Run the included launcher:
```cmd
start-server.cmd
```
or via CLI:
```bash
trueforge --port 3000
```
TrueForge runs in local standalone mode on `http://localhost:3000` with documentation at `http://localhost:3000/api/v1/docs`.

### 3. Install Extension in VS Code

You can install the pre-packaged `.vsix` directly:
1. In VS Code, open the Extensions view (`Ctrl+Shift+X`).
2. Click `...` (More Actions) > **Install from VSIX...**
3. Select `forge-vscode-agent-1.0.0.vsix`.

Alternatively, open this directory in VS Code and press **F5** to start an Extension Development Host.

### 4. Build & Test Commands

```bash
# Build extension host, stdio bridge, and webview
npm run build

# Type-check TypeScript codebase
npm run typecheck

# Run automated test suites (including Task A E2E simulation)
npm test

# Package to VSIX
npm run package
```

---

## Task A Verification (Flask 3.1.3 Inline Edit)

To verify Task A manually:
1. Clone Flask:
   ```bash
   git clone https://github.com/pallets/flask
   cd flask && git checkout 3.1.3
   ```
2. Open `src/flask/helpers.py` in VS Code.
3. Highlight the `get_debug_flag` function.
4. Press `Ctrl+K` (or `Cmd+K` on macOS) to open the TrueForge Inline Edit prompt.
5. Enter:
   > "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false."
6. **Verify the Diff Pipeline**:
   - Red line highlights (`rgba(248, 81, 73, 0.18)`) appear over modified blocks.
   - Per-hunk CodeLens appears:
     - `$(check) Accept Hunk (#1: Update docstring...)`
     - `$(check) Accept Hunk (#2: Add 'off' and 'n'...)`
     - `$(diff) Side-by-Side Diff`
     - `$(pass) LSP: 0 errors`
   - Click **Accept Hunk** to apply changes.
   - Press `Ctrl+Z` to verify native editor undo.
   - Execute command `Forge: Undo Last Agent Change` (`trueforge.undoLastTurn`) to verify full turn rollback.

---

## Embedded MCP Tools

The extension starts an embedded MCP server on an ephemeral port (`127.0.0.1:0`), recorded in `.vscode/trueforge-mcp.json`:

| Tool | Description |
|------|-------------|
| `workspace_tree` | Recursive directory tree with `.gitignore` filtering and line counts |
| `workspace_search` | Workspace-wide text search |
| `list_symbols` | LSP document/workspace symbol discovery |
| `read_file_range` | Read 1-indexed lines (max 250 lines, dirty-buffer aware) |
| `get_diagnostics` | LSP error/warning diagnostics |
| `propose_file_edit` | Stage hunks for human review (zero direct disk write) |
| `create_file` | Stage new file creation |
| `delete_file` | Stage file deletion |
| `run_terminal_cmd` | Shell execution with timeout protection |

---

## License

Apache-2.0 — See [LICENSE](./LICENSE)
