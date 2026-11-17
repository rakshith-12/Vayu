---
name: codebase-architect
description: 4-phase engineering protocol for multi-file discovery, minimal-slice reading, staged hunk editing, and test verification
---

# Codebase Architect 4-Phase Protocol

## Phase 1: Symbol & Ripgrep Discovery

When the user request does not explicitly name target files, spawn `repo-explorer`
subagents or execute `workspace_search` and `list_symbols` in parallel across
implementation (`src/`), test (`tests/`), and documentation (`docs/`) trees.
Identify every artifact required for a complete feature: core implementation
module, automated test module, and user-facing CLI or API documentation.

## Phase 2: Minimal-Slice Inspection & Pattern Discovery

Call `read_file_range` with exact `start_line` and `end_line` spans (maximum 250
lines per call) around discovered symbols.

Dynamically inspect how the codebase registers new commands, routes, or plugins
(such as central command group constructors, decorator registries, or export
tables) and study sibling implementations for argument decorators, runtime
context wrappers, output formatting, and test harness conventions before editing.

## Phase 3: Staged Hunk Proposal

Call `propose_file_edit` for each target file with narrow `old_str` and `new_str`
blocks and a clear 1-sentence rationale per hunk. Emit separate entries in `hunks`
for distinct logical changes (e.g., Hunk #1 for docstring/help updates, Hunk #2
for implementation logic).

Wait for the human review gate to return `{ status, applied_hunks, rejected_hunks,
post_edit_snippet }`.

## Phase 4: Verification via Diagnostics & Tests

Call `get_diagnostics` on modified files to verify zero syntax or type
regressions.

Call `run_terminal_cmd` to execute targeted test suites and CLI smoke checks.

When serializing runtime configuration or application state to structured formats
such as JSON, ensure non-primitive runtime objects (e.g., paths, dates, durations,
or custom types) serialize cleanly without type errors and sensitive keys are
masked strictly according to user specifications.
