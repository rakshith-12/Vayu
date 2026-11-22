# TrueForge VS Code Coding Agent - Complete Architectural & Technical Specification

**Version:** 1.0.0  
**Status:** Production Ready  
**Target Environments:** VS Code 1.85.0+ / Cursor / Windsurf, Node.js v18+, TrueForge v0.185.1+  
**Tested Codebase:** Flask 3.1.3 (`src/flask/helpers.py:get_debug_flag`)  
**Verified Active Models:** `google-gemini/gemini-3-5-flash-lite`, `google-gemini/gemini-3-1-flash-lite`, `gemma-4-31b-it`

---

## 1. Executive Summary & System Overview

The **TrueForge VS Code Coding Agent** is an enterprise-grade developer assistant integrated natively into VS Code. It bridges local developer workflows with the local **TrueForge** agent daemon (`http://localhost:3000`) to deliver fast, resilient, non-destructive AI code modifications and multi-file reasoning.

The system is architected around 4 core pillars:
1. **Zero-Destruction Human-in-the-Loop Review**: All code suggestions are staged into a memory buffer (`StagingBuffer`), decomposed into atomic hunks, visualized via native side-by-side diffs (`vscode.diff`), and applied using bottom-to-top line offset adjustments.
2. **Dual Operational Modes**:
   - **Mode 1 (Inline Edit - `Ctrl+K`)**: Sub-second surgical edits directly within the active editor selection.
   - **Mode 2 (Agent Mode)**: Multi-file lexical (BM25) and AST symbol search, dynamic budget management via Context Ledger, and TOC overflow promotion.
3. **Resilience & Fault Tolerance**: Automatic 5-second connection watchdog timers, exponential backoff retries on transient network and HTTP 5xx errors, and automatic model failover.
4. **Low-Latency Streaming & Dual Cancellation Engine**: SSE streaming with real-time UI updates, zero-leak socket aborts via `AbortController`, and server-side turn cancellation.

```mermaid
flowchart TD
    User([Developer in VS Code]) -->|Ctrl+K or Sidebar UI| ExtHost[Extension Host]
    
    subgraph UI_Layer ["Modern Presentation Layer"]
        Sidebar[TrueForge Sidebar Panel]
        DiffView["Native vscode.diff Split Editor"]
        Notification["Accept All / Reject Action Banners"]
    end

    subgraph Core_Engine ["TrueForge Extension Core"]
        ContextRetriever[Context Retriever: BM25 + AST]
        Ledger[Context Ledger Tracker]
        Supervisor[Resilience Supervisor]
        Client[TrueForge HTTP / SSE Client]
        StreamParser[SSE StreamHandler]
        HunkDecomposer[Hunk Decomposer]
        Staging[Staging Buffer Queue]
        Applier[Bottom-to-Top Workspace Applier]
        UndoStack[Turn Checkpoint Undo Stack]
    end

    subgraph Backend_Daemon ["TrueForge Local Daemon (Port 3000)"]
        TFServer[TrueForge Engine v0.185.1]
        ModelProvider[Google Gemini AI Studio API]
    end

    ExtHost --> Sidebar
    ExtHost --> DiffView
    ExtHost --> Notification
    Sidebar -->|Submit Turn| ContextRetriever
    ContextRetriever --> Ledger
    Ledger --> Supervisor
    Supervisor --> Client
    Client -->|POST /api/v1/sessions/:id/turns| TFServer
    TFServer -->|LLM Inference| ModelProvider
    TFServer -->|SSE Event Stream| StreamParser
    StreamParser -->|Deltas| Sidebar
    StreamParser -->|Finished Output| HunkDecomposer
    HunkDecomposer --> Staging
    Staging --> DiffView
    Staging --> Applier
    Applier --> UndoStack
```

---

## 2. Operational Modes Specification

### 2.1 Mode 1: Fast Inline Code Editing (`Ctrl+K`)
* **Trigger**: Highlight code in any editor, press <kbd>Ctrl+K</kbd> (or <kbd>Cmd+K</kbd>), enter a description in the quick input box.
* **Context Assembly**:
  * Scopes the active editor file path, language ID, surrounding context window ($\pm 35$ lines), and exact selection line range.
  * System directive enforces strict code-block output with markdown comments indicating replaced code.
* **Review & Application Lifecycle**:
  1. Turn output streams to the user in real-time.
  2. `decomposeIntoHunks` parses original lines against proposed lines, creating isolated `StagedHunk` instances.
  3. A virtual in-memory file is registered under the `trueforge-diff:` URI scheme.
  4. The native VS Code diff viewer is opened automatically:
     ```typescript
     vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, 'Proposed Diff');
     ```
  5. An actionable banner offers immediate 1-click `Accept All` or `Reject All`.
  6. On acceptance, `WorkspaceApplier` applies changes **bottom-to-top** so line indices never drift.
  7. A snapshot is pushed onto `UndoStack` enabling instantaneous rollback with `Ctrl+Shift+P` &rarr; `Forge: Undo Last Agent Change`.

### 2.2 Mode 2: Agent Retrieval & Multi-Signal Context Orchestration
* **Trigger**: Select **Agent Mode (Mode 2)** in the sidebar dropdown or mention `@file` / `@symbol` in the prompt.
* **Context Retrieval Engine (`src/context/retriever.ts`)**:
  * **Lexical BM25 Search**: Tokenizes queries and ranks workspace files with term-frequency and inverse document frequency scoring.
  * **Symbol Provider Search**: Uses `vscode.executeWorkspaceSymbolProvider` to match AST function and class symbols.
  * **Explicit Mentions**: Regex captures `@file:<path>`, `@symbol:<name>`, and `@<name>`.
* **Dynamic Context Ledger (`src/context/ledgerTracker.ts`)**:
  * Tracks token usage with an empirical ratio ($\approx 3.8\text{ chars/token}$).
  * Fits the highest-scoring slices within a strict budget cap (e.g. 16,000 tokens).
  * Overflow symbols that exceed the budget are downgraded into a lightweight **Table of Contents (TOC)** with symbol signatures.
  * Developers can promote overflow TOC entries into full slices or pin slices to survive subsequent turns.

---

## 3. Streaming and Cancellation Protocol (Task 3 / Task C)

### 3.1 Streaming Pipeline
* **Endpoint**: `POST /api/v1/sessions/:id/turns` with header `Accept: text/event-stream` and payload `{ stream: true }`.
* **Event Demultiplexing**: Handled by `StreamHandler` via `eventsource-parser`:
  * `model.message.delta`: Streams raw token deltas into the Webview chat terminal.
  * `tool_call_start`: Renders visual tool invocation markers.
  * `turn.done`: Extracts final full response from `state.output.content` if SSE deltas were omitted.
  * `[DONE]`: Cleanly terminates generator iteration.

### 3.2 Dual-Tier Cancellation Engine
```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant UI as Sidebar / Keybinding
    participant Ext as Extension Host
    participant Stream as StreamHandler
    participant Client as TrueForgeClient
    participant TF as TrueForge Daemon (:3000)

    Dev->>UI: Press Escape OR Click "Stop"
    UI->>Ext: trueforge.stopGeneration
    activate Ext
    Ext->>Stream: abort()
    Stream->>Stream: AbortController.abort() (Closes SSE Socket)
    Ext->>Client: cancelSession(sessionId)
    Client->>TF: POST /api/v1/sessions/:id/cancel
    TF-->>Client: 200 OK (Turn Aborted)
    Ext->>Ext: stagingBuffer.clearAllPendingWithCancelledStatus()
    Ext->>UI: panelProvider.setGenerating(false)
    Ext->>Dev: Show "TrueForge generation cancelled."
    deactivate Ext
```

---

## 4. Resilience Supervisor & Fault Tolerance

```mermaid
flowchart LR
    Start([Execute Turn]) --> TryReq[Attempt HTTP / SSE Fetch]
    TryReq --> CheckSuccess{HTTP 200 OK?}
    CheckSuccess -- Yes --> ReturnStream[Yield SSE Event Stream]
    CheckSuccess -- "Transient (5xx, 429, ECONNREFUSED)" --> CanRetry{Attempt < MaxAttempts?}
    CanRetry -- Yes --> Backoff[Sleep backoffMs * attempt] --> TryReq
    CanRetry -- No --> CheckFailover{Fallback Model Configured?}
    CheckFailover -- Yes --> Failover[Switch to Fallback Model] --> NotifyUser[Notify Failover Event] --> TryReq
    CheckFailover -- No --> ThrowError[Display Error Notification]
```

* **Parameters**:
  * `connectionTimeoutMs`: 5,000 ms per connection attempt.
  * `maxAttempts`: 2 tries with exponential backoff (`backoffMs: 500ms`).
  * `primaryModel`: `google-gemini/gemini-3-5-flash-lite`.
  * `fallbackModel`: `google-gemini/gemini-3-1-flash-lite` (or `gemma-4-31b-it`).
* **Dual-Stack Loopback Resolution**: Automatically cycles candidate URLs (`127.0.0.1:3000` $\leftrightarrow$ `localhost:3000`) to guarantee Windows IPv4/IPv6 compatibility.
* **Pre-flight Validator**: Pings `/api/v1/models` during activation. If the server is offline, it provides clear troubleshooting guidance instead of failing silently.

---

## 5. Non-Destructive Staging Buffer & Multi-Turn Undo

1. **Hunk Decomposition**:
   * Analyzes line-by-line diffs between original content and proposed content.
   * Groups contiguous modified, added, or deleted lines into indexed `StagedHunk` structs.
2. **Bottom-to-Top Application**:
   * Sorted in reverse line order (`b.oldStart - a.oldStart`).
   * Applying modifications at line 100 first ensures line 20 modifications remain at their exact original coordinates.
3. **Turn Checkpointing**:
   * Before applying any hunk or file edit, `UndoStack` stores an atomic snapshot containing `{ turnId, fileSnapshots: [{ filePath, beforeContent, afterContent }] }`.
   * Triggering `trueforge.undoLastTurn` reverts modified workspace files in a single atomic transaction.

---

## 6. Modernized UI Design Specification

The Webview UI follows VS Code's modern design standards:
* **Adaptive Theme Variables**: Fully integrates with `--vscode-sideBar-background`, `--vscode-editorWidget-background`, and custom CSS color tokens.
* **Glassmorphic Card Hierarchy**:
  * **Header**: Live connection status pill with glowing pulsing green dot, clickable model chip.
  * **Context Ledger Card**: Dynamic animated progress bar (blue-to-indigo gradient), live token counter (`0 / 16,000 tokens`), and interactive Pin/Unpin slice badges.
  * **Staged Edits Drawer**: Appears on demand when diffs are ready, featuring atomic hunk cards with LSP zero-regression indicators, side-by-side diff shortcuts, and Accept/Reject buttons.
  * **Agent Terminal**: Monospace code stream container with smooth auto-scroll.
  * **Input Section**: Floating rounded textarea with focus ring, mode selector, <kbd>Ctrl+Enter</kbd> submit shortcut, and interactive Stop button.

---

## 7. Automated Test Suite & Benchmark Matrix

The test suite runs synchronously with `npm.cmd test`:

| # | Test Suite Item | Target Component | Status | Latency |
|---|----------------|-------------------|--------|---------|
| 1 | Token Estimation Contract | `src/types/contracts.ts` | **PASS** | 0.74 ms |
| 2 | SSE Stream Event Parser | `src/trueforge/streamHandler.ts` | **PASS** | 20.98 ms |
| 3 | Transient Retry & Backoff | `src/trueforge/resilience.ts` | **PASS** | 20.54 ms |
| 4 | Automatic Model Failover | `src/trueforge/resilience.ts` | **PASS** | 15.97 ms |
| 5 | Mention Regex Parser (`@file`, `@symbol`) | `src/types/contracts.ts` | **PASS** | 0.55 ms |
| 6 | HttpError Preserves Status Codes | `src/types/contracts.ts` | **PASS** | 0.20 ms |
| 7 | ContextLedger Pinning & TOC Promotion | `src/context/ledgerTracker.ts` | **PASS** | 0.63 ms |
| 8 | ConfigValidator Offline Pre-flight | `src/trueforge/configValidator.ts` | **PASS** | 11.18 ms |
| 9 | StreamHandler Cancellation & Socket Abort | `src/trueforge/streamHandler.ts` | **PASS** | 0.27 ms |
| 10 | Task A E2E: Flask 3.1.3 Inline Edit Staging | `tests/task_a_e2e.test.mjs` | **PASS** | 23.77 ms |
| **Total** | **10 Passing Suites** | | **100% PASS** | **~3.2 s** |

---

## 8. File Structure Reference

```text
forge-vscode-agent/
├── SPECIFICATION.md                 # Complete System Specification
├── package.json                     # Extension manifest, commands & keybindings
├── esbuild.config.mjs               # Optimized multi-target bundler
├── forge-vscode-agent-1.0.0.vsix    # Packaged production extension binary
├── agent/
│   ├── forge-coding-agent.yaml      # TrueForge agent definition (gemini-3-5-flash-lite)
│   └── skills/codebase-architect/   # Agent skill metadata
├── src/
│   ├── extension.ts                 # Extension entry point & command registrations
│   ├── context/
│   │   ├── ledgerTracker.ts         # Token ledger, budget manager & TOC overflow
│   │   └── retriever.ts             # BM25 lexical search & symbol search
│   ├── diff/
│   │   ├── hunks.ts                 # Diff calculation & hunk decomposition
│   │   ├── stagingBuffer.ts         # Staging buffer queue & gate resolution
│   │   └── workspaceApplier.ts      # Bottom-to-top file applier
│   ├── trueforge/
│   │   ├── client.ts                # REST & SSE communication with TrueForge
│   │   ├── configValidator.ts       # Pre-flight environment & connectivity checks
│   │   ├── modelSwitcher.ts         # QuickPick model selector
│   │   ├── resilience.ts            # Retries, connection watchdogs & model failover
│   │   └── streamHandler.ts         # SSE streaming parser & cancellation controller
│   ├── undo/
│   │   └── undoStack.ts             # Snapshot checkpointing & multi-turn rollback
│   ├── webview/
│   │   ├── panelProvider.ts         # Webview HTML/CSS provider
│   │   └── ui/index.ts              # Frontend client script with keyboard shortcuts
│   └── types/
│       └── contracts.ts             # TypeScript interfaces & message schemas
└── tests/
    ├── mvp.test.mjs                 # Unit tests (token, stream, resilience, abort)
    ├── task_a_e2e.test.mjs          # End-to-end Flask 3.1.3 inline edit test
    ├── mock-vscode.js               # Headless VS Code API mock
    └── run-tests.mjs                # Test execution harness
```
