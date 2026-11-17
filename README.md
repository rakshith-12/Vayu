# TrueForge VS Code Coding Agent

An enterprise-grade, editor-native VS Code coding agent powered by a local [TrueForge](https://github.com/truefoundry/trueforge) daemon (`http://localhost:3000`).

Provides non-destructive inline editing (`Ctrl+K`), multi-file agent context retrieval (BM25 + AST symbol search), real-time SSE streaming, zero-leak cancellation, and automated model failover.

---

## 🚀 60-Second Quickstart

No build tools needed! You can install and run this immediately.

### 1. Prerequisites
- **VS Code** (or Cursor / Windsurf) >= 1.85.0
- **Node.js** >= 18.0.0
- A **Google Gemini API Key** (Free from [Google AI Studio](https://aistudio.google.com/app/apikey))

---

### 2. Install the Extension in VS Code
You can install the included pre-built `.vsix` file in one of two ways:

#### Option A: Command Line
```bash
code --install-extension forge-vscode-agent-1.0.0.vsix
```

#### Option B: VS Code UI
1. Open VS Code.
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on macOS) to open the **Extensions** view.
3. Click the `...` (Views and More Actions) menu in the top-right corner.
4. Select **Install from VSIX...**
5. Choose `forge-vscode-agent-1.0.0.vsix`.

---

### 3. Start the TrueForge Server

#### On Windows:
Double-click or run:
```cmd
start-server.cmd
```

#### On macOS / Linux:
```bash
chmod +x start-server.sh
./start-server.sh
```

*(Alternatively, run `npx @truefoundry/trueforge --port 3000`)*

---

### 4. Configure Your Gemini API Key
Once TrueForge is running on port 3000, register your Google Gemini API key:

#### Option A: Web Browser UI
1. Open [http://localhost:3000](http://localhost:3000) in your browser.
2. Go to **Settings** &rarr; **Model Providers**.
3. Select **Google Gemini** and enter your API key.

#### Option B: Terminal Command
Replace `YOUR_GEMINI_API_KEY` with your key and run:

**Windows PowerShell:**
```powershell
$body = @{ apiKey = "YOUR_GEMINI_API_KEY" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/api/v1/settings/model-providers/google-gemini" -Method Put -Body $body -ContentType "application/json"
```

**macOS / Linux:**
```bash
curl -X PUT "http://localhost:3000/api/v1/settings/model-providers/google-gemini" \
     -H "Content-Type: application/json" \
     -d '{"apiKey": "YOUR_GEMINI_API_KEY"}'
```

---

## 🎮 How to Test & Demo the 3 Core Tasks

### Task 1: Mode 1 Inline Edit (`Ctrl+K`)
1. Open any source file in VS Code (e.g. Python, TypeScript, JavaScript).
2. Highlight a function or a block of lines.
3. Press **`Ctrl+K`** (or **`Cmd+K`** on Mac).
4. Enter an instruction, for example:
   ```text
   Treat values "off" and "n" as false as well, case-insensitively, and update the docstring.
   ```
5. Press **Enter**.
6. The side-by-side diff (`vscode.diff`) will automatically open.
7. Click **Accept All** on the notification banner to apply the edits bottom-to-top.
8. To undo at any time, press `Ctrl+Shift+P` &rarr; select **`Forge: Undo Last Agent Change`**.

---

### Task 2: Mode 2 Agent Retrieval & Context Ledger
1. Click the **TrueForge Agent** icon in the VS Code Activity Bar (left sidebar).
2. In the dropdown, switch the mode to **Agent Mode (Mode 2)**.
3. Type a query that references specific files or symbols using `@`:
   ```text
   How does @file:src/flask/helpers.py interact with @symbol:get_debug_flag?
   ```
4. Press **`Ctrl+Enter`** (or click **Send**).
5. Notice the **Context Ledger** progress bar fill up with token metrics, and view pinned context slices and Table of Contents (TOC) overflow entries.

---

### Task 3: Streaming & Cancellation
1. In the TrueForge sidebar panel, ask a question that produces a long answer:
   ```text
   Write an exhaustive 5-page guide explaining the entire WSGI request-response lifecycle of Flask.
   ```
2. Press **`Ctrl+Enter`**.
3. **Observe Streaming**: Watch the code and text stream character-by-character in real time in the Agent Stream box.
4. **Test Cancellation**: While it is generating, press **`Escape`** or click the red **Stop** button.
5. The stream halts immediately, the socket connection terminates, and a notification confirms:
   > `TrueForge generation cancelled.`

---

## 🛠️ Building & Testing From Source

If you want to modify the TypeScript code or run tests:

```bash
# 1. Install dependencies
npm install

# 2. Run automated test suites (13/13 passing)
npm test

# 3. Build bundle with esbuild
npm run build

# 4. Package a new .vsix
npx vsce package --no-dependencies --allow-missing-repository
```

---

## 📁 Repository Structure

```text
├── forge-vscode-agent-1.0.0.vsix   # Pre-built extension binary (ready to install)
├── SPECIFICATION.md                # Full technical specification & architecture
├── README.md                       # This setup guide
├── package.json                    # Extension manifest & command bindings
├── esbuild.config.mjs              # Fast bundler config
├── start-server.cmd                # TrueForge server launcher (Windows)
├── start-server.sh                 # TrueForge server launcher (macOS/Linux)
├── config.example.yaml             # Example model routing config
├── src/
│   ├── extension.ts                # Main extension activation & command routing
│   ├── context/
│   │   ├── ledgerTracker.ts        # Token ledger, budget manager & TOC overflow
│   │   └── retriever.ts            # BM25 lexical & AST workspace symbol retriever
│   ├── diff/
│   │   ├── hunks.ts                # Hunk decomposition algorithm
│   │   ├── stagingBuffer.ts        # Review queue & approval coordinator
│   │   └── workspaceApplier.ts     # Bottom-to-top safe line edit applier
│   ├── trueforge/
│   │   ├── client.ts               # REST & SSE communication with TrueForge
│   │   ├── configValidator.ts      # Health checks & pre-flight diagnostics
│   │   ├── modelSwitcher.ts        # QuickPick interactive model selector
│   │   ├── resilience.ts           # 5s watchdog, retry backoff & model failover
│   │   └── streamHandler.ts        # SSE stream generator & AbortController
│   ├── undo/
│   │   └── undoStack.ts            # Checkpoint snapshots & turn-level rollback
│   └── webview/
│       ├── panelProvider.ts        # Modern glassmorphic Webview provider
│       └── ui/index.ts             # Sidebar UI frontend logic & shortcuts
└── tests/
    ├── all_tasks_verification.test.mjs # Unified test covering Tasks 1, 2, and 3
    ├── mvp.test.mjs                    # Unit tests for contracts, streaming & resilience
    └── task_a_e2e.test.mjs             # E2E Flask 3.1.3 inline edit test
```

---

## 📜 License
MIT License. Built for use with Google Antigravity and TrueForge.
