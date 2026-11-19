/**
 * @file contracts.ts
 * @description Canonical shared type definitions for the TrueForge VS Code extension.
 *              Every module in the extension imports its types from this file.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Section 3.1 — Execution & Context Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The execution mode for a TrueForge turn.
 * - `inline-edit`  — edits are applied to the current editor in-place.
 * - `agent-mode`   — the model drives a multi-step agentic loop.
 */
export type ExecutionMode = 'inline-edit' | 'agent-mode';

/**
 * Describes how a {@link ContextSlice} was sourced into the context window.
 */
export type ContextSourceType =
  | 'user-pinned'
  | 'mention-file'
  | 'mention-symbol'
  | 'symbol-search'
  | 'ripgrep-bm25'
  | 'ast-import-neighbor'
  | 'repo-map'
  | 'mcp-tool-read';

/**
 * A single slice of source context fed to the model.
 * Slices are ranked by {@link score} and trimmed to stay within the token budget.
 */
export interface ContextSlice {
  /** Unique identifier for this slice. */
  id: string;
  /** Absolute path of the file this slice was extracted from. */
  filePath: string;
  /** 1-based start line (inclusive). */
  startLine: number;
  /** 1-based end line (inclusive). */
  endLine: number;
  /** Estimated token count consumed by this slice. */
  tokens: number;
  /** How this slice was discovered / sourced. */
  source: ContextSourceType;
  /** Relevance score used for ranking (higher = more relevant). */
  score: number;
  /** Human-readable explanation of why this slice was included. */
  rationale: string;
  /** The raw text content of the slice. */
  content: string;
  /** Whether the user has explicitly pinned this slice. */
  pinned: boolean;
  /** `true` when the slice was promoted from the overflow TOC. */
  promotedFromToc?: boolean;
}

/**
 * An entry in the overflow table-of-contents — a symbol that scored high
 * enough to be noted but was trimmed from the full context window.
 */
export interface TocOverflowEntry {
  /** Unique identifier for this TOC entry. */
  id: string;
  /** Absolute path of the file containing the symbol. */
  filePath: string;
  /** Name of the symbol (function, class, variable, etc.). */
  symbolName: string;
  /** 1-based start line (inclusive). */
  startLine: number;
  /** 1-based end line (inclusive). */
  endLine: number;
  /** Estimated token count the full slice would consume. */
  tokens: number;
  /** Relevance score at the time of overflow. */
  score: number;
}

/**
 * An immutable snapshot of the context-ledger state for a single turn.
 * Sent to the webview via the `ledger:updated` IPC message.
 */
export interface ContextLedgerSnapshot {
  /** The turn this snapshot belongs to. */
  turnId: string;
  /** Execution mode in effect for the turn. */
  mode: ExecutionMode;
  /** Soft token budget cap configured by the user. */
  budgetCap: number;
  /** Hard token ceiling that must never be exceeded. */
  ceilingCap: number;
  /** Total tokens actually consumed by all slices. */
  totalTokensUsed: number;
  /** Per-slot breakdown of token usage. */
  slotBreakdown: {
    /** Tokens used by system prompt and repo map. */
    systemAndMap: number;
    /** Tokens used by user-pinned files and @-mentions. */
    mentionsAndPinned: number;
    /** Tokens used by ripgrep + BM25 search results. */
    ripgrepBm25: number;
    /** Tokens used by AST import-neighbor slices. */
    astImports: number;
    /** Tokens used by MCP tool-read results. */
    mcpToolReads: number;
  };
  /** All included slices (without their heavy `content` field). */
  slices: Omit<ContextSlice, 'content'>[];
  /** Symbols that overflowed and are available for promotion. */
  overflowToc: TocOverflowEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3.2 — Diff & Staging Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lifecycle status of a single diff hunk inside a staged file review.
 */
export type HunkStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Summary of diagnostics produced by the shadow workspace
 * after tentatively applying a hunk.
 */
export interface ShadowDiagnosticSummary {
  /** Count of new errors introduced by this hunk. */
  newErrors: number;
  /** Count of new warnings introduced by this hunk. */
  newWarnings: number;
  /** `true` when the hunk introduces zero new diagnostics. */
  zeroRegression: boolean;
  /** Individual diagnostic messages (e.g. from `tsc` or ESLint). */
  messages: string[];
  /** Unix-ms timestamp of the last diagnostic check. */
  checkedAt: number;
}

/**
 * A single diff hunk that the model has proposed.
 * Hunks are presented to the user for per-hunk accept / reject decisions.
 */
export interface StagedHunk {
  /** Unique identifier for this hunk. */
  id: string;
  /** ID of the parent {@link StagedFileReview}. */
  fileId: string;
  /** Absolute path of the file this hunk modifies. */
  filePath: string;
  /** 0-based index of the hunk within its file's hunk array. */
  index: number;
  /** Start line in the original file (1-based). */
  oldStart: number;
  /** Number of lines removed from the original file. */
  oldLines: number;
  /** Start line in the proposed file (1-based). */
  newStart: number;
  /** Number of lines added in the proposed file. */
  newLines: number;
  /** The original text being replaced. */
  oldText: string;
  /** The replacement text proposed by the model. */
  newText: string;
  /** Model-generated explanation of the change. */
  rationale: string;
  /** Current user decision status. */
  status: HunkStatus;
  /** Optional diagnostics from the shadow workspace. */
  shadowDiagnostics?: ShadowDiagnosticSummary;
}

/**
 * A full file-level review containing one or more hunks.
 * The review is presented in a queue and resolved via {@link resolveGate}.
 */
export interface StagedFileReview {
  /** Unique identifier for this file review. */
  fileId: string;
  /** The turn that generated this review. */
  turnId: string;
  /** Absolute path of the file under review. */
  filePath: string;
  /** `true` when the file did not exist before this turn. */
  isNewFile: boolean;
  /** `true` when the model proposes deleting the file entirely. */
  isDeleteFile: boolean;
  /** The full original content of the file (empty string for new files). */
  originalContent: string;
  /** The full proposed content after all hunks are applied. */
  proposedFullContent: string;
  /** Ordered list of diff hunks within this file. */
  hunks: StagedHunk[];
  /** Optional ID linking to a tool-approval request. */
  approvalId?: string;
  /** Callback invoked to resolve the review gate with the user's decision. */
  resolveGate: (resolution: ProposeEditResolution) => void;
}

/**
 * The resolution emitted when a user finishes reviewing a file's hunks.
 */
export interface ProposeEditResolution {
  /** Overall outcome of the review. */
  status: 'applied' | 'partially_applied' | 'rejected' | 'cancelled';
  /** 0-based indices of accepted hunks. */
  applied_hunks: number[];
  /** 0-based indices of rejected hunks. */
  rejected_hunks: number[];
  /** A small snippet of the file after edits, for confirmation UX. */
  post_edit_snippet: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TrueForge SSE Stream Event Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discriminator values for SSE events streamed from the TrueForge backend.
 */
export type TrueForgeStreamEventType =
  | 'text_delta'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'tool_result'
  | 'tool_approval_required'
  | 'model_failover'
  | 'turn_complete'
  | 'error';

/**
 * Base interface for all TrueForge SSE stream events.
 * Concrete event interfaces extend this with narrowed `type` literals.
 */
export interface TrueForgeStreamEvent {
  /** Discriminator identifying the event kind. */
  type: TrueForgeStreamEventType;
  /** Extensible payload — concrete sub-interfaces add typed fields. */
  [key: string]: unknown;
}

/** A chunk of assistant text streamed incrementally. */
export interface TextDeltaEvent extends TrueForgeStreamEvent {
  type: 'text_delta';
  /** The incremental text fragment. */
  delta: string;
}

/** Signals the start of a new tool invocation. */
export interface ToolCallStartEvent extends TrueForgeStreamEvent {
  type: 'tool_call_start';
  /** The name of the tool being called. */
  toolName: string;
  /** Unique ID correlating start / delta / end events for this call. */
  callId: string;
}

/** An incremental chunk of JSON arguments for an in-progress tool call. */
export interface ToolCallDeltaEvent extends TrueForgeStreamEvent {
  type: 'tool_call_delta';
  /** Correlates with the originating {@link ToolCallStartEvent.callId}. */
  callId: string;
  /** Incremental JSON fragment of the tool's arguments. */
  argumentsDelta: string;
}

/** Marks that the tool call's argument stream is complete. */
export interface ToolCallEndEvent extends TrueForgeStreamEvent {
  type: 'tool_call_end';
  /** Correlates with the originating {@link ToolCallStartEvent.callId}. */
  callId: string;
}

/** Carries the result returned by an executed tool. */
export interface ToolResultEvent extends TrueForgeStreamEvent {
  type: 'tool_result';
  /** Correlates with the originating {@link ToolCallStartEvent.callId}. */
  callId: string;
  /** The tool's return value (shape depends on the tool). */
  result: unknown;
}

/** The backend is requesting user approval before executing a tool. */
export interface ToolApprovalRequiredEvent extends TrueForgeStreamEvent {
  type: 'tool_approval_required';
  /** Unique ID used to approve or deny this request. */
  approvalId: string;
  /** Name of the tool awaiting approval. */
  toolName: string;
  /** Arguments the tool would be called with. */
  arguments: Record<string, unknown>;
}

/** Notification that the backend failed over to a different model. */
export interface ModelFailoverEvent extends TrueForgeStreamEvent {
  type: 'model_failover';
  /** Model identifier that was in use before failover. */
  fromModel: string;
  /** Model identifier now in use after failover. */
  toModel: string;
  /** Human-readable reason for the failover (e.g. "rate_limited"). */
  reason: string;
}

/** Signals that the current turn has completed successfully. */
export interface TurnCompleteEvent extends TrueForgeStreamEvent {
  type: 'turn_complete';
  /** The ID of the completed turn. */
  turnId: string;
}

/** An error occurred during streaming. */
export interface ErrorEvent extends TrueForgeStreamEvent {
  type: 'error';
  /** Human-readable error description. */
  message: string;
  /** Optional machine-readable error code. */
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8 — Webview ↔ Host IPC Message Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of all messages the webview can send to the extension host
 * via `vscode.postMessage`.
 *
 * 9 message types: submit_turn, stop_generation, hunk_decision,
 * file_decision, toggle_native_diff, pin_slice, promote_toc,
 * reveal_hunk, query_mentions.
 */
export type WebviewToHostMessage =
  | { type: 'user:submit_turn'; prompt: string; mode: ExecutionMode }
  | { type: 'user:stop_generation' }
  | { type: 'user:hunk_decision'; hunkId: string; decision: 'accepted' | 'rejected' }
  | { type: 'user:file_decision'; fileId: string; decision: 'accept_all' | 'reject_all' }
  | { type: 'user:toggle_native_diff'; fileId: string; hunkIndex?: number }
  | { type: 'user:pin_slice'; sliceId: string; pinned: boolean }
  | { type: 'user:promote_toc'; tocEntryId: string }
  | { type: 'user:reveal_hunk'; filePath: string; line: number }
  | { type: 'user:query_mentions'; prefix: string }
  | { type: 'user:switch_model' }
  | { type: 'user:refresh_status' };

/**
 * Union of all messages the extension host can send to the webview
 * via `webview.postMessage`.
 *
 * 6 message types: ledger:updated, stream:event, diff:queue_updated,
 * stream:text_delta, mentions:results, status:updated.
 */
export type HostToWebviewMessage =
  | { type: 'ledger:updated'; ledger: ContextLedgerSnapshot }
  | { type: 'stream:event'; event: TrueForgeStreamEvent }
  | { type: 'diff:queue_updated'; activeReview: StagedFileReview | null; queuedCount: number; canUndo: boolean }
  | { type: 'stream:text_delta'; delta: string }
  | { type: 'mentions:results'; items: Array<{ label: string; filePath: string; kind: string }> }
  | {
      type: 'status:updated';
      serverOnline: boolean;
      modelOnline: boolean;
      activeModel: string;
      serverUrl?: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Undo Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A snapshot of a single file's content captured before edits,
 * used by the undo system to restore files.
 */
export interface UndoFileSnapshot {
  /** Absolute path of the file. */
  filePath: string;
  /** `true` if the file existed before the turn (false for newly created files). */
  existedBefore: boolean;
  /** Raw file bytes at the time of the snapshot. */
  rawBytes: Buffer;
}

/**
 * A checkpoint representing the state of all modified files at the
 * start of a turn, enabling full-turn undo.
 */
export interface UndoCheckpoint {
  /** The turn this checkpoint was created for. */
  turnId: string;
  /** Pre-edit snapshots for every file touched in the turn. */
  snapshots: UndoFileSnapshot[];
  /** Unix-ms timestamp when the checkpoint was created. */
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions & Errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An HTTP-level error carrying the status code so that the resilience layer
 * can make failover / retry decisions.
 */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

/**
 * Fast, allocation-light token estimator.
 * Uses the empirical average of ~3.8 characters per token for English code.
 *
 * @param s - The string to estimate tokens for.
 * @returns An upper-bound estimate of the token count.
 */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3.8);
}
