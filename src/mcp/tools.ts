/**
 * @file tools.ts
 * @description All 8 workspace MCP tools + terminal runner for TrueForge.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import ignore from 'ignore';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StagingBuffer } from '../diff/stagingBuffer';
import type { ShadowDiagnosticsChecker } from '../diff/shadowDiagnostics';
import type { VirtualDiffProvider } from '../diff/virtualDiffProvider';
import type { UndoCheckpointStack } from '../diff/undoStack';
import type { StagedFileReview, StagedHunk } from '../types/contracts';

export interface ToolContext {
  stagingBuffer: StagingBuffer;
  shadowDiagnostics: ShadowDiagnosticsChecker;
  virtualDiffProvider: VirtualDiffProvider;
  undoStack: UndoCheckpointStack;
  getCurrentTurnId: () => string;
}

export function registerMcpTools(server: McpServer, ctx: ToolContext): void {
  const getWorkspaceRoot = (): string => {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      return folders[0].uri.fsPath;
    }
    return process.cwd();
  };

  const resolvePath = (p: string): string => {
    if (path.isAbsolute(p)) return p;
    return path.join(getWorkspaceRoot(), p);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // 1. workspace_tree
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'workspace_tree',
    'Recursive workspace directory tree respecting .gitignore, with line counts',
    {
      path: z.string().optional().describe('Relative or absolute path to list'),
      max_depth: z.number().optional().describe('Maximum directory depth (default: 4)'),
    },
    async ({ path: relPath, max_depth: maxDepth = 4 }) => {
      const rootDir = relPath ? resolvePath(relPath) : getWorkspaceRoot();
      const ig = ignore();

      // Read .gitignore if present
      const gitignorePath = path.join(rootDir, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        try {
          ig.add(fs.readFileSync(gitignorePath, 'utf8'));
        } catch {
          // ignore
        }
      }
      ig.add(['.git', 'node_modules', 'dist', '.vscode', '__pycache__', '*.pyc', '.DS_Store']);

      const lines: string[] = [];

      function traverse(dir: string, depth: number, prefix: string) {
        if (depth > maxDepth) return;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        // Sort: directories first, then alphabetical
        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const fullPath = path.join(dir, entry.name);
          const relToRoot = path.relative(rootDir, fullPath).replace(/\\/g, '/');

          if (ig.ignores(relToRoot) || ig.ignores(relToRoot + '/')) {
            continue;
          }

          const isLast = i === entries.length - 1;
          const marker = isLast ? '└── ' : '├── ';
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');

          if (entry.isDirectory()) {
            lines.push(`${prefix}${marker}${entry.name}/`);
            traverse(fullPath, depth + 1, nextPrefix);
          } else {
            let lineCount = 0;
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              lineCount = content.split('\n').length;
            } catch {
              // ignore
            }
            lines.push(`${prefix}${marker}${entry.name} (${lineCount} lines)`);
          }
        }
      }

      lines.push(`${path.basename(rootDir)}/`);
      traverse(rootDir, 1, '');

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 2. workspace_search
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'workspace_search',
    'Search for regex or text across workspace files',
    {
      query: z.string().describe('Search query or regex'),
      case_sensitive: z.boolean().optional().describe('Case-sensitive matching'),
      max_results: z.number().optional().describe('Maximum matches to return (default: 50)'),
      path_filter: z.string().optional().describe('Glob or substring to filter file paths'),
    },
    async ({ query, case_sensitive = false, max_results = 50, path_filter }) => {
      const results: string[] = [];

      try {
        const fileUris = await vscode.workspace.findFiles(
          path_filter || '**/*',
          '**/{node_modules,.git,dist}/**',
          200,
        );

        const regex = new RegExp(query, case_sensitive ? 'g' : 'gi');

        for (const uri of fileUris) {
          if (results.length >= max_results) break;
          try {
            const data = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(data).toString('utf8');
            const lines = text.split(/\r?\n/);
            const rel = vscode.workspace.asRelativePath(uri);

            for (let i = 0; i < lines.length; i++) {
              if (results.length >= max_results) break;
              if (regex.test(lines[i])) {
                results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
              }
              regex.lastIndex = 0;
            }
          } catch {
            // ignore binary/unreadable files
          }
        }
      } catch {
        // Fallback
      }

      const outputText =
        results.length > 0
          ? results.slice(0, max_results).join('\n')
          : `No matches found for query: "${query}"`;

      return {
        content: [{ type: 'text', text: outputText }],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 3. list_symbols
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'list_symbols',
    'List symbols (functions, classes, variables) in a file or the whole workspace',
    {
      query: z.string().optional().describe('Symbol name query'),
      file_path: z.string().optional().describe('Specific file to query symbols from'),
    },
    async ({ query, file_path }) => {
      const symbolsOut: string[] = [];

      if (file_path) {
        const absPath = resolvePath(file_path);
        const uri = vscode.Uri.file(absPath);
        try {
          const docSymbols = (await vscode.commands.executeCommand(
            'vscode.executeDocumentSymbolProvider',
            uri,
          )) as vscode.DocumentSymbol[] | undefined;

          if (docSymbols) {
            function formatDocSymbols(syms: vscode.DocumentSymbol[], indent: string) {
              for (const sym of syms) {
                const kindName = vscode.SymbolKind[sym.kind] || 'Symbol';
                symbolsOut.push(
                  `${indent}${kindName} ${sym.name} (lines ${sym.range.start.line + 1}-${sym.range.end.line + 1})`,
                );
                if (sym.children && sym.children.length > 0) {
                  formatDocSymbols(sym.children, indent + '  ');
                }
              }
            }
            formatDocSymbols(docSymbols, '');
          }
        } catch {
          // ignore
        }
      } else {
        try {
          const wsSymbols = (await vscode.commands.executeCommand(
            'vscode.executeWorkspaceSymbolProvider',
            query || '',
          )) as vscode.SymbolInformation[] | undefined;

          if (wsSymbols) {
            for (const sym of wsSymbols.slice(0, 100)) {
              const kindName = vscode.SymbolKind[sym.kind] || 'Symbol';
              const rel = vscode.workspace.asRelativePath(sym.location.uri);
              const line = sym.location.range.start.line + 1;
              symbolsOut.push(`${kindName} ${sym.name} in ${rel}:${line}`);
            }
          }
        } catch {
          // ignore
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: symbolsOut.length > 0 ? symbolsOut.join('\n') : 'No symbols found',
          },
        ],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 4. read_file_range
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'read_file_range',
    'Read a specific 1-indexed line range from a file (max 250 lines), dirty-buffer aware',
    {
      file_path: z.string().describe('File path to read'),
      start_line: z.number().describe('1-indexed starting line (inclusive)'),
      end_line: z.number().describe('1-indexed ending line (inclusive)'),
    },
    async ({ file_path, start_line, end_line }) => {
      const absPath = resolvePath(file_path);

      // Clamp span to 250 lines
      const cappedEndLine = Math.min(end_line, start_line + 249);

      let content = '';
      // 1. Check open text documents for dirty buffer
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath.toLowerCase() === absPath.toLowerCase(),
      );

      if (openDoc) {
        content = openDoc.getText();
      } else if (fs.existsSync(absPath)) {
        content = fs.readFileSync(absPath, 'utf8');
      } else {
        return {
          content: [{ type: 'text', text: `Error: File not found: ${file_path}` }],
          isError: true,
        };
      }

      const allLines = content.split(/\r?\n/);
      const startIdx = Math.max(0, start_line - 1);
      const endIdx = Math.min(allLines.length, cappedEndLine);

      const outputLines: string[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        outputLines.push(`${i + 1}: ${allLines[i]}`);
      }

      return {
        content: [{ type: 'text', text: outputLines.join('\n') }],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 5. get_diagnostics
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'get_diagnostics',
    'Retrieve compiler / linter diagnostics (errors and warnings)',
    {
      file_path: z.string().optional().describe('Target file or empty for workspace-wide'),
    },
    async ({ file_path }) => {
      const diagsOut: string[] = [];

      if (file_path) {
        const absPath = resolvePath(file_path);
        const uri = vscode.Uri.file(absPath);
        const diags = vscode.languages.getDiagnostics(uri);
        for (const d of diags) {
          if (
            d.severity === vscode.DiagnosticSeverity.Error ||
            d.severity === vscode.DiagnosticSeverity.Warning
          ) {
            const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
            diagsOut.push(`${file_path}:${d.range.start.line + 1}: [${sev}] ${d.message}`);
          }
        }
      } else {
        const allDiags = vscode.languages.getDiagnostics();
        for (const [uri, diags] of allDiags) {
          const rel = vscode.workspace.asRelativePath(uri);
          for (const d of diags) {
            if (
              d.severity === vscode.DiagnosticSeverity.Error ||
              d.severity === vscode.DiagnosticSeverity.Warning
            ) {
              const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
              diagsOut.push(`${rel}:${d.range.start.line + 1}: [${sev}] ${d.message}`);
            }
          }
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: diagsOut.length > 0 ? diagsOut.join('\n') : 'No diagnostics found (0 errors, 0 warnings)',
          },
        ],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 6. propose_file_edit
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'propose_file_edit',
    'Stage narrow hunks for human review. Never writes directly to disk.',
    {
      file_path: z.string().describe('File path to edit'),
      hunks: z.array(
        z.object({
          old_str: z.string().describe('Existing exact string block to replace'),
          new_str: z.string().describe('Proposed replacement string block'),
          rationale: z.string().describe('One-sentence rationale for this hunk'),
        }),
      ),
    },
    async ({ file_path, hunks }) => {
      const absPath = resolvePath(file_path);
      const turnId = ctx.getCurrentTurnId();

      // Read current content from dirty buffer or disk
      let currentContent = '';
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath.toLowerCase() === absPath.toLowerCase(),
      );

      if (openDoc) {
        currentContent = openDoc.getText();
      } else if (fs.existsSync(absPath)) {
        currentContent = fs.readFileSync(absPath, 'utf8');
      } else {
        return {
          content: [{ type: 'text', text: `Error: File not found: ${file_path}` }],
          isError: true,
        };
      }

      const normalizedCurrent = currentContent.replace(/\r\n/g, '\n');
      const lines = normalizedCurrent.split('\n');

      // Snapshot file before first modification in this turn
      await ctx.undoStack.ensureFileSnapshotted(turnId, absPath);

      const fileId = `review-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const stagedHunks: StagedHunk[] = [];

      let simulatedContent = normalizedCurrent;

      for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i];
        const oldNorm = hunk.old_str.replace(/\r\n/g, '\n');
        const newNorm = hunk.new_str.replace(/\r\n/g, '\n');

        // Locate old_str in simulatedContent
        let matchIdx = simulatedContent.indexOf(oldNorm);
        if (matchIdx === -1) {
          // Line-trimmed fuzzy match
          const oldTrimmed = oldNorm.trim();
          matchIdx = simulatedContent.indexOf(oldTrimmed);
        }

        let oldStart = 1;
        let oldLines = oldNorm.split('\n').length;
        let newLines = newNorm.split('\n').length;

        if (matchIdx !== -1) {
          const prefix = simulatedContent.substring(0, matchIdx);
          oldStart = prefix.split('\n').length;
        }

        const stagedHunk: StagedHunk = {
          id: `hunk-${fileId}-${i}`,
          fileId,
          filePath: absPath,
          index: i,
          oldStart,
          oldLines,
          newStart: oldStart,
          newLines,
          oldText: hunk.old_str,
          newText: hunk.new_str,
          rationale: hunk.rationale,
          status: 'pending',
        };

        stagedHunks.push(stagedHunk);

        if (matchIdx !== -1) {
          simulatedContent =
            simulatedContent.substring(0, matchIdx) +
            newNorm +
            simulatedContent.substring(matchIdx + oldNorm.length);
        }
      }

      // Check shadow diagnostics
      const shadowDiags = await ctx.shadowDiagnostics.verifyHunksInShadowDoc(
        absPath,
        simulatedContent,
        stagedHunks,
      );

      for (const sh of stagedHunks) {
        sh.shadowDiagnostics = shadowDiags;
      }

      // Materialize proposed full content in virtual diff provider
      const diffUri = vscode.Uri.parse(`trueforge-diff:${absPath}`);
      ctx.virtualDiffProvider.setContent(diffUri, simulatedContent);

      const fileReview: StagedFileReview = {
        fileId,
        turnId,
        filePath: absPath,
        isNewFile: false,
        isDeleteFile: false,
        originalContent: currentContent,
        proposedFullContent: simulatedContent,
        hunks: stagedHunks,
        resolveGate: () => {}, // Bound inside stagingBuffer
      };

      // Park until user completes review
      const resolution = await ctx.stagingBuffer.enqueueFileReview(fileReview);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(resolution, null, 2),
          },
        ],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 7. create_file
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'create_file',
    'Stage creation of a new file for review',
    {
      file_path: z.string().describe('File path to create'),
      content: z.string().describe('Initial content of the file'),
      rationale: z.string().describe('One-sentence rationale for creating this file'),
    },
    async ({ file_path, content, rationale }) => {
      const absPath = resolvePath(file_path);
      const turnId = ctx.getCurrentTurnId();

      await ctx.undoStack.ensureFileSnapshotted(turnId, absPath);

      const fileId = `create-${Date.now()}`;
      const hunk: StagedHunk = {
        id: `hunk-${fileId}-0`,
        fileId,
        filePath: absPath,
        index: 0,
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: content.split('\n').length,
        oldText: '',
        newText: content,
        rationale,
        status: 'pending',
      };

      const fileReview: StagedFileReview = {
        fileId,
        turnId,
        filePath: absPath,
        isNewFile: true,
        isDeleteFile: false,
        originalContent: '',
        proposedFullContent: content,
        hunks: [hunk],
        resolveGate: () => {},
      };

      const resolution = await ctx.stagingBuffer.enqueueFileReview(fileReview);
      return {
        content: [{ type: 'text', text: JSON.stringify(resolution, null, 2) }],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 8. delete_file
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'delete_file',
    'Stage deletion of an existing file for review',
    {
      file_path: z.string().describe('File path to delete'),
      rationale: z.string().describe('One-sentence rationale for deleting this file'),
    },
    async ({ file_path, rationale }) => {
      const absPath = resolvePath(file_path);
      const turnId = ctx.getCurrentTurnId();

      let originalContent = '';
      if (fs.existsSync(absPath)) {
        originalContent = fs.readFileSync(absPath, 'utf8');
      }

      await ctx.undoStack.ensureFileSnapshotted(turnId, absPath);

      const fileId = `delete-${Date.now()}`;
      const hunk: StagedHunk = {
        id: `hunk-${fileId}-0`,
        fileId,
        filePath: absPath,
        index: 0,
        oldStart: 1,
        oldLines: originalContent.split('\n').length,
        newStart: 1,
        newLines: 0,
        oldText: originalContent,
        newText: '',
        rationale,
        status: 'pending',
      };

      const fileReview: StagedFileReview = {
        fileId,
        turnId,
        filePath: absPath,
        isNewFile: false,
        isDeleteFile: true,
        originalContent,
        proposedFullContent: '',
        hunks: [hunk],
        resolveGate: () => {},
      };

      const resolution = await ctx.stagingBuffer.enqueueFileReview(fileReview);
      return {
        content: [{ type: 'text', text: JSON.stringify(resolution, null, 2) }],
      };
    },
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Terminal runner tool
  // ───────────────────────────────────────────────────────────────────────────
  server.tool(
    'run_terminal_cmd',
    'Run a shell command in the workspace root with a timeout',
    {
      command: z.string().describe('Shell command to execute'),
      timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
    },
    async ({ command, timeout_ms = 30000 }) => {
      const cwd = getWorkspaceRoot();

      return new Promise((resolve) => {
        exec(command, { cwd, timeout: timeout_ms }, (err, stdout, stderr) => {
          const out = stdout ? stdout.toString() : '';
          const errOut = stderr ? stderr.toString() : '';
          const exitCode = err ? (err as { code?: number }).code ?? 1 : 0;

          const combined = [
            out,
            errOut ? `\nSTDERR:\n${errOut}` : '',
            exitCode !== 0 ? `\nCommand exited with code ${exitCode}` : '',
          ]
            .filter(Boolean)
            .join('');

          resolve({
            content: [{ type: 'text', text: combined || 'Command executed with no output.' }],
          });
        });
      });
    },
  );
}
